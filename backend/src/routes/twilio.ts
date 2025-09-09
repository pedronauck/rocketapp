import type { Hono } from 'hono';
import type { UpgradeWebSocket, WSContext, WSMessageReceive } from 'hono/ws';
import { nanoid } from 'nanoid';
import { generateTwiML } from '../utils/twiml';
import {
  streamAnswer,
  streamAnswerWithMessages,
  type SimpleMessage,
} from '../services/ai';
import { validateTwilioSignature } from '../utils/twilio-signature';
import { getEnv } from '../config/env';
import { log } from '../utils/log';
import { sessions } from '../services/session';
import { parseKnownMessage } from '../types/relay';
import { getRandomThinkingMessage } from '../utils/thinking-messages';
import type { Context } from 'hono';
import { getDatabase } from '../db/database';
import { getBatchWriter } from '../services/batch-writer';
import { getMessageQueue } from '../services/message-queue';
import { getStreamCoordinator } from '../services/stream-coordinator';

// Helpers
function resolveRelayWsUrl(req: Request): string {
  const env = getEnv();
  const envUrl = env.RELAY_WS_URL;
  if (envUrl) return envUrl;
  // Derive from incoming request host; default to ws for local
  const url = new URL(req.url);
  const scheme = url.protocol === 'https:' ? 'wss' : 'ws';
  const host = url.host; // includes port
  return `${scheme}://${host}/twilio/relay`;
}

type UpgradeWS = UpgradeWebSocket;

export function registerTwilioRoutes(app: Hono, upgradeWebSocket: UpgradeWS) {
  const env = getEnv();
  registerTwiMLRoute(app, env);
  registerVoiceRoute(app, env);
  registerRelayRoutes(app, upgradeWebSocket, env);
}

function registerTwiMLRoute(app: Hono, env: ReturnType<typeof getEnv>) {
  app.post('/twiml', async (c) => respondWithTwiML(c, env));
  app.get('/twiml', async (c) => respondWithTwiML(c, env));
}

function registerVoiceRoute(app: Hono, env: ReturnType<typeof getEnv>) {
  app.post('/twilio/voice', async (c) => {
    const ok = await validateSignatureIfConfigured(c, env);
    if (!ok)
      return c.json(
        { error: 'unauthorized', message: 'Invalid Twilio signature' },
        401
      );
    const wsUrl = resolveRelayWsUrl(c.req.raw);
    const xml = generateTwiML({
      websocketUrl: wsUrl,
      welcomeGreeting: env.RELAY_WELCOME_GREETING,
    });
    log.info('[twilio] POST /twilio/voice -> replying TwiML with ws URL');
    return c.text(xml, 200, { 'Content-Type': 'text/xml' });
  });
}

function registerRelayRoutes(
  app: Hono,
  upgradeWebSocket: UpgradeWS,
  env: ReturnType<typeof getEnv>
) {
  const handlerFactory = makeRelayHandlerFactory(env);
  app.get('/ws', upgradeWebSocket(handlerFactory));
  app.get('/twilio/relay', upgradeWebSocket(handlerFactory));
}

async function respondWithTwiML(c: Context, env: ReturnType<typeof getEnv>) {
  // Extract phone number from Twilio POST data
  let phoneNumber = '';
  let welcomeGreeting = env.RELAY_WELCOME_GREETING || 'Welcome to the Pokédex Call Center.';
  
  if (c.req.method === 'POST') {
    try {
      const formData = await c.req.parseBody();
      phoneNumber = (formData.From as string) || '';
      log.info('[twilio] Extracted phone number', { phoneNumber });
      
      // Quick caller lookup for personalized greeting
      if (phoneNumber) {
        try {
          const db = getDatabase();
          const caller = await db.getCallerQuickly(phoneNumber, 50); // 50ms timeout for TwiML response
          
          if (caller?.name) {
            // Special pronunciation for bdougie
            const displayName = caller.name === 'bdougie' ? 'bee dug ee' : caller.name;
            
            // Array of greeting variations
            const greetings = [
              `Sup ${displayName}! What Pokémon can I help you with today?`,
              `Yo ${displayName}, good to hear from you! Which Pokémon are we looking up today?`,
              `Hey ${displayName}, welcome back! What Pokémon info do you need?`,
              `${displayName}! Great to hear from you again. What Pokémon should we explore?`,
              `What's up ${displayName}? Ready to dive into some Pokémon facts?`
            ];
            
            // Pick a random greeting
            welcomeGreeting = greetings[Math.floor(Math.random() * greetings.length)];
            log.info('[twilio] Personalized greeting for returning caller', { name: caller.name, greeting: welcomeGreeting });
          } else {
            welcomeGreeting = 'Welcome to the Pokédex Call Center. May I have your name please?';
            log.info('[twilio] Default greeting for new caller');
          }
        } catch (err) {
          log.error('[twilio] Error during caller lookup for greeting', err);
        }
      }
    } catch (err) {
      log.error('[twilio] Failed to parse form data', err);
    }
  }

  const domain = env.NGROK_URL;
  let wsUrl = domain
    ? `wss://${domain}/ws`
    : resolveRelayWsUrl(c.req.raw).replace('/twilio/relay', '/ws');

  // Add phone number as query parameter if available
  if (phoneNumber) {
    wsUrl += `?phone=${encodeURIComponent(phoneNumber)}`;
  }

  const xml = generateTwiML({
    websocketUrl: wsUrl,
    welcomeGreeting,
  });
  log.info('[twilio] respondWithTwiML -> replying TwiML with ws URL', { wsUrl, welcomeGreeting });
  return c.text(xml, 200, { 'Content-Type': 'text/xml' });
}

async function validateSignatureIfConfigured(
  c: Context,
  env: ReturnType<typeof getEnv>
) {
  const authToken = env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true;
  const contentType = c.req.header('content-type') || '';
  const formParams = contentType.includes('application/x-www-form-urlencoded')
    ? ((await c.req.parseBody()) as Record<
        string,
        string | Blob | File | undefined
      >)
    : undefined;
  const reqUrl = new URL(c.req.url);
  const host = c.req.header('host') || reqUrl.host;
  const protoHdr = c.req.header('x-forwarded-proto');
  const proto = (protoHdr || reqUrl.protocol.replace(':', '')).toLowerCase();
  const urlForSig = `${proto}://${host}${reqUrl.pathname}${reqUrl.search}`;
  return validateTwilioSignature({
    url: urlForSig,
    method: c.req.method,
    headers: c.req.raw.headers,
    formParams,
    authToken,
  });
}

function makeRelayHandlerFactory(env: ReturnType<typeof getEnv>) {
  const isDebug = env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace';
  return (c: any) => {
    let currentAbort: any = null;
    let callSid: string | null = null;
    let phoneNumber: string | null = null;
    const connectionId = nanoid(6);

    // Extract phone number from query parameters
    try {
      const url = new URL(c.req.url);
      phoneNumber = url.searchParams.get('phone');
      if (phoneNumber) {
        log.info('[relay] Phone number extracted from URL', { phoneNumber });
      }
    } catch (err) {
      log.error('[relay] Failed to extract phone from URL', err);
    }

    return {
      onOpen() {
        log.info('[relay] open', { connectionId, phoneNumber });
      },
      async onMessage(event: MessageEvent<WSMessageReceive>, ws: WSContext) {
        try {
          const parsed = safeParseMessage(event);
          if (!parsed) return;
          await routeRelayMessage({
            parsed,
            ws,
            state: {
              connectionId,
              callSidRef: () => callSid,
              setCallSid: (v: string | null) => (callSid = v),
              phoneNumber,
            },
            abortRef: {
              get: () => currentAbort,
              set: (a: any) => (currentAbort = a),
            },
            isDebug,
          });
        } catch (err) {
          log.error('[relay] onMessage:error', {
            error: (err as any)?.message || String(err),
          });
        }
      },
      onError() {
        if (currentAbort) currentAbort.abort('ws-error');
        log.error('[relay] ws:error', { connectionId, callSid });
      },
      onClose() {
        if (currentAbort) currentAbort.abort('ws-closed');
        currentAbort = null;

        // Clean up message queue and stream coordinator
        if (callSid) {
          const messageQueue = getMessageQueue();
          const streamCoordinator = getStreamCoordinator();
          
          // Clear any pending messages
          messageQueue.clear(callSid);
          
          // Clear stream state
          streamCoordinator.clearCall(callSid);
        }

        // Mark conversation as ended using batch writer
        if (callSid && phoneNumber) {
          try {
            const batchWriter = getBatchWriter();
            const finalMessages = sessions.get(callSid) || [];
            batchWriter.enqueue(callSid, finalMessages, true); // true = ended, will flush immediately
            log.info('[relay] Marked conversation as ended in batch', {
              callSid,
            });
          } catch (err) {
            log.error('[relay] Failed to mark conversation as ended', err);
          }
        }

        if (callSid) sessions.clear(callSid);
        log.info('[relay] close', { connectionId, callSid, phoneNumber });
      },
    };
  };
}

function safeParseMessage(event: MessageEvent<WSMessageReceive>) {
  const data = typeof event.data === 'string' ? event.data : '';
  if (!data) return null;
  
  try {
    const raw = JSON.parse(data);
    return parseKnownMessage(raw) || raw;
  } catch (err) {
    log.error('[relay] Failed to parse WebSocket message', {
      error: (err as any)?.message || String(err),
      data: data.slice(0, 100), // Log first 100 chars for debugging
    });
    return null;
  }
}

function extractNameFromResponse(text: string): string | null {
  // Common patterns for name introduction
  const patterns = [
    /my name is (\w+)/i,
    /i'm (\w+)/i,
    /i am (\w+)/i,
    /this is (\w+)/i,
    /call me (\w+)/i,
    /it's (\w+)/i,
    /^(\w+)$/i, // Single word response (likely just the name)
  ];
  
  for (const pattern of patterns) {
    const match = text.trim().match(pattern);
    if (match && match[1]) {
      // Capitalize first letter
      const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      // Basic validation - reasonable length and only letters
      if (name.length >= 2 && name.length <= 20 && /^[A-Za-z]+$/.test(name)) {
        return name;
      }
    }
  }
  
  return null;
}

type RelayState = {
  connectionId: string;
  callSidRef: () => string | null;
  setCallSid: (v: string | null) => void;
  phoneNumber: string | null;
  // Additional state properties
  callerName?: string;
  isNewCaller?: boolean;
  nameExtracted?: boolean;
  pendingInterrupt?: boolean;
  ttsStoppedByUser?: boolean;
};
type AbortRef = { get: () => any; set: (a: any) => void };

async function routeRelayMessage(args: {
  parsed: any;
  ws: WSContext;
  state: RelayState;
  abortRef: AbortRef;
  isDebug: boolean;
}) {
  const { parsed, ws, state, abortRef, isDebug } = args;
  const type = parsed?.type;
  switch (type) {
    case 'setup':
      return handleSetup(parsed, state);
    case 'prompt':
      return handlePrompt(parsed, ws, state, abortRef, isDebug);
    case 'interrupt':
      return handleInterrupt(state, abortRef, ws);
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    default:
      return; // ignore lifecycle and unknown
  }
}

async function handleSetup(parsed: any, state: RelayState) {
  const callSid = parsed?.callSid || null;
  state.setCallSid(callSid);
  
  if (callSid) {
    // Start with base system prompt
    let systemPrompt = getEnv().SYSTEM_PROMPT || 'You are a helpful Pokédex assistant.';
    let callerName: string | null = null;
    
    // Quick caller lookup with timeout
    if (state.phoneNumber) {
      try {
        const db = getDatabase();
        
        // Check for existing conversation (recovery scenario)
        const existingConv = await db.getConversationBySid(callSid);
        
        if (existingConv && existingConv.messages) {
          // Recover conversation context
          try {
            const messages = JSON.parse(existingConv.messages) as SimpleMessage[];
            if (messages.length > 0) {
              sessions.set(callSid, messages);
              log.info('[relay] Recovered conversation from database', {
                callSid,
                messageCount: messages.length
              });
            }
          } catch (parseErr) {
            log.error('[relay] Failed to parse recovered messages', parseErr);
          }
        } else {
          // Check for recent unclosed conversation (within last 5 minutes)
          const recentConvs = await db.getRecentConversation(state.phoneNumber, 1);
          if (recentConvs.length > 0 && !recentConvs[0].ended_at) {
            const timeSinceStart = Date.now() / 1000 - recentConvs[0].started_at;
            if (timeSinceStart < 300) { // 5 minutes
              try {
                const messages = JSON.parse(recentConvs[0].messages) as SimpleMessage[];
                if (messages.length > 0) {
                  // Recover context from previous unclosed conversation
                  sessions.set(callSid, messages);
                  log.info('[relay] Recovered recent unclosed conversation', {
                    oldCallSid: recentConvs[0].call_sid,
                    newCallSid: callSid,
                    messageCount: messages.length,
                    ageSeconds: Math.round(timeSinceStart)
                  });
                }
              } catch (parseErr) {
                log.error('[relay] Failed to parse recent conversation messages', parseErr);
              }
            }
          }
          
          // Create new conversation record
          db.createConversation(callSid, state.phoneNumber);
          log.info('[relay] Created conversation in database', {
            callSid,
            phoneNumber: state.phoneNumber,
          });
        }
        
        // Try to get caller info quickly (100ms timeout)
        const caller = await db.getCallerQuickly(state.phoneNumber, 100);
        
        // Get conversation context for returning callers (non-blocking)
        let contextPromise: Promise<any> | null = null;
        if (caller?.name) {
          contextPromise = db.getConversationContext(state.phoneNumber, 24); // Last 24 hours
        }
        
        if (caller?.name) {
          // Returning caller - personalized greeting
          callerName = caller.name;
          // Special pronunciation for bdougie
          const displayName = callerName === 'bdougie' ? 'bee dug ee' : callerName;
          
          // Get conversation context if available
          let contextInfo = '';
          if (contextPromise) {
            try {
              const context = await Promise.race([
                contextPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 150)) // 150ms timeout
              ]);
              
              if (context && (context.recentTopics?.length > 0 || context.conversationCount > 0)) {
                const timeSinceLastCall = context.lastCallTime 
                  ? Math.floor((Date.now() / 1000 - context.lastCallTime) / 3600) 
                  : null;
                
                // Build context string
                if (context.recentTopics.length > 0) {
                  contextInfo = ` Recently, they've asked about ${context.recentTopics.join(', ')}.`;
                }
                
                if (timeSinceLastCall !== null && timeSinceLastCall < 1) {
                  contextInfo += ' They called less than an hour ago.';
                } else if (timeSinceLastCall !== null && timeSinceLastCall < 24) {
                  contextInfo += ` They last called ${timeSinceLastCall} hours ago.`;
                }
                
                log.info('[relay] Added conversation context', {
                  phoneNumber: state.phoneNumber,
                  topics: context.recentTopics,
                  conversationCount: context.conversationCount
                });
              }
            } catch (err) {
              log.debug('[relay] Could not get conversation context', { err });
            }
          }
          
          // Variety of casual system prompts with context
          const prompts = [
            `You are a friendly Pokédex assistant. The caller is ${callerName} (pronounced "${displayName}").${contextInfo} They just heard a greeting, so jump right in with a casual "So what Pokémon are you curious about?" or similar. Keep it brief and conversational.`,
            `You are a helpful Pokédex assistant. ${callerName} (pronounced "${displayName}") is calling back.${contextInfo} Since they were already greeted, just ask casually what Pokémon they want to know about. Be friendly but brief.`,
            `You're the Pokédex assistant. ${callerName} (pronounced "${displayName}") just called and was greeted.${contextInfo} Follow up naturally with something like "Which Pokémon should we look up?" Keep it casual and short.`,
            `You are a knowledgeable Pokédex assistant. The caller ${callerName} (pronounced "${displayName}") was just welcomed.${contextInfo} Simply ask what Pokémon info they need today. Stay casual and concise.`,
            `You're helping ${callerName} (pronounced "${displayName}") with Pokémon information.${contextInfo} They just heard a greeting, so get right to it - ask what Pokémon they're interested in. Keep it friendly and brief.`
          ];
          
          // If they've talked about specific Pokemon recently, we can reference them
          if (contextInfo.includes('Recently')) {
            const contextAwarePrompts = [
              `You are a friendly Pokédex assistant. ${callerName} is back!${contextInfo} They were just greeted. You can reference their previous interests if relevant, or help with something new. Keep it natural and brief.`,
              `You're the Pokédex assistant helping ${callerName}.${contextInfo} After the greeting, see if they want to continue exploring those topics or learn about something new. Stay conversational.`
            ];
            prompts.push(...contextAwarePrompts);
          }
          
          systemPrompt = prompts[Math.floor(Math.random() * prompts.length)];
          log.info('[relay] Recognized returning caller', { name: callerName });
        } else {
          // New caller - ask for name
          systemPrompt = `You are a helpful Pokédex assistant. This is a first-time caller. Start by welcoming them to the Pokédex Call Center and politely ask for their name before helping with Pokémon questions. Once they provide their name, acknowledge it warmly and then help with their Pokémon questions.`;
          log.info('[relay] New caller detected');
        }
      } catch (err) {
        log.error('[relay] Error during caller lookup', err);
      }
    }
    
    // Initialize session with customized prompt
    sessions.getOrInit(
      callSid,
      [{ role: 'system', content: systemPrompt }] as SimpleMessage[]
    );
    
    // Store caller info in state for later use
    state.callerName = callerName;
    state.isNewCaller = !callerName;
  }
  
  log.info('[relay] setup', { 
    connectionId: state.connectionId, 
    callSid,
    phoneNumber: state.phoneNumber,
    isNewCaller: !state.callerName
  });
}

async function handlePrompt(
  parsed: any,
  ws: WSContext,
  state: RelayState,
  abortRef: AbortRef,
  isDebug: boolean
) {
  const text: string = parsed?.voicePrompt || parsed?.text || '';
  if (!text) return;
  
  const callSid = state.callSidRef();
  const streamCoordinator = getStreamCoordinator();
  const messageQueue = getMessageQueue();
  
  // Check if this is a stop command
  const isStopCommand = text.toLowerCase().trim() === 'stop' || 
                       text.toLowerCase().includes('stop talking') ||
                       text.toLowerCase().includes('stop speaking');
  
  // Check if stream is currently active
  if (callSid && streamCoordinator.isStreamActive(callSid)) {
    if (isStopCommand) {
      // User said "stop" - send stop signal to client to halt TTS
      // but don't abort the stream (let it finish internally for context)
      ws.send(JSON.stringify({ type: 'stop' }));
      
      log.info('[relay] TTS stopped by user command (stream continues internally)', {
        connectionId: state.connectionId,
        callSid,
        command: text,
      });
      
      // Clear interrupt flag
      state.pendingInterrupt = false;
      
      // Mark that we should skip sending remaining chunks to client
      state.ttsStoppedByUser = true;
      return;
    }
    
    // Queue the message instead of processing immediately
    messageQueue.enqueue(callSid, {
      type: 'prompt',
      content: text,
      voicePrompt: parsed?.voicePrompt,
      callSid,
    });
    
    log.info('[relay] prompt queued (stream active)', {
      connectionId: state.connectionId,
      callSid,
      textPreview: text.slice(0, 50),
      pendingCount: messageQueue.getPendingCount(callSid),
    });
    
    // Clear interrupt flag
    state.pendingInterrupt = false;
    return; // Don't process now, will be handled after current stream
  }
  
  // Clear interrupt flag
  state.pendingInterrupt = false;
  
  // Process the prompt immediately
  await processPrompt(text, ws, state, abortRef, isDebug);
}

async function processPrompt(
  text: string,
  ws: WSContext,
  state: RelayState,
  abortRef: AbortRef,
  isDebug: boolean
) {
  const callSid = state.callSidRef();
  const streamCoordinator = getStreamCoordinator();
  const messageQueue = getMessageQueue();
  
  // Check if this is a new caller and try to extract their name
  if (state.isNewCaller && !state.nameExtracted) {
    const extractedName = extractNameFromResponse(text);
    if (extractedName && state.phoneNumber) {
      try {
        const db = getDatabase();
        await db.saveCallerName(state.phoneNumber, extractedName);
        state.callerName = extractedName;
        state.nameExtracted = true;
        log.info('[relay] Extracted and saved caller name', { 
          name: extractedName, 
          phoneNumber: state.phoneNumber 
        });
        
        // Update the session's system prompt to reflect we now know their name
        if (callSid) {
          const history = sessions.get(callSid) || [];
          if (history.length > 0 && history[0].role === 'system') {
            history[0].content = `You are a helpful Pokédex assistant. The caller's name is ${extractedName}. You've just learned their name, so acknowledge it warmly and continue helping with their Pokémon questions.`;
            sessions.set(callSid, history);
          }
        }
      } catch (err) {
        log.error('[relay] Failed to save caller name', err);
      }
    }
  }
  
  // Register stream start
  if (callSid) {
    streamCoordinator.registerStreamStart(callSid);
  }
  
  startAbort(abortRef);
  const { turnId, startedAt } = logPromptReceived(text, state);
  const timer = startTimeout(abortRef);
  try {
    // Send a quick placeholder so callers hear immediate feedback
    const env = getEnv();
    if (env.RELAY_THINKING_ENABLED) {
      const thinking = getRandomThinkingMessage();
      if (thinking) {
        ws.send(JSON.stringify({ type: 'text', token: thinking, last: false }));
      }
    }

    const { stream, usedMessages } = await getTextStream(state, text, abortRef);
    logStreamStart(isDebug, state, turnId, usedMessages);
    
    // Update activity during streaming
    let activityTimer: Timer | null = null;
    if (callSid) {
      activityTimer = setInterval(() => {
        streamCoordinator.updateActivity(callSid);
      }, 5000); // Update every 5 seconds
    }
    
    const { chunks, chars, fullResponse } = await sendStream(ws, stream, state);
    
    if (activityTimer) clearInterval(activityTimer);
    
    // Save assistant response to session and database
    if (callSid && fullResponse) {
      const history = sessions.get(callSid) || [];
      const withAssistant: SimpleMessage[] = [
        ...history,
        { role: 'assistant', content: fullResponse },
      ];
      sessions.set(callSid, withAssistant);
      
      // Use batch writer for efficient database updates
      if (state.phoneNumber) {
        try {
          const batchWriter = getBatchWriter();
          batchWriter.enqueue(callSid, withAssistant, false);
          log.debug('[relay] Queued conversation update with assistant response', {
            callSid,
            messageCount: withAssistant.length,
          });
        } catch (err) {
          log.error('[relay] Failed to queue conversation update', err);
        }
      }
    }
    
    logStreamFinish(state, turnId, startedAt, chunks, chars);
    
    // Register stream end
    if (callSid) {
      streamCoordinator.registerStreamEnd(callSid);
      
      // Process queued messages after stream completes
      await processQueuedMessages(ws, state, abortRef, isDebug);
    }
  } catch (err) {
    logStreamError(state, turnId, startedAt, err);
    // Register stream end even on error
    if (callSid) {
      streamCoordinator.registerStreamEnd(callSid);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function processQueuedMessages(
  ws: WSContext,
  state: RelayState,
  abortRef: AbortRef,
  isDebug: boolean
) {
  const callSid = state.callSidRef();
  if (!callSid) return;
  
  const messageQueue = getMessageQueue();
  const streamCoordinator = getStreamCoordinator();
  
  // Check if there are pending messages
  if (!messageQueue.hasPending(callSid)) {
    log.debug('[relay] No queued messages to process', { callSid });
    return;
  }
  
  // Get next message from queue
  const nextMessage = messageQueue.getNext(callSid);
  if (!nextMessage) return;
  
  log.info('[relay] Processing queued message', {
    callSid,
    messageId: nextMessage.id,
    type: nextMessage.type,
    remainingCount: messageQueue.getPendingCount(callSid) - 1,
  });
  
  // Mark message as processed
  messageQueue.markProcessed(callSid, nextMessage.id);
  
  // Process based on message type
  if (nextMessage.type === 'prompt' && nextMessage.content) {
    // Add a small delay for natural conversation flow
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Process the queued prompt
    await processPrompt(nextMessage.content, ws, state, abortRef, isDebug);
  } else if (nextMessage.type === 'interrupt') {
    // For queued interrupts, we might want to acknowledge them differently
    log.info('[relay] Skipping queued interrupt (already handled by queuing)', {
      callSid,
      messageId: nextMessage.id,
    });
    
    // Continue processing other queued messages
    if (messageQueue.hasPending(callSid)) {
      await processQueuedMessages(ws, state, abortRef, isDebug);
    }
  }
}

function handleInterrupt(state: RelayState, abortRef: AbortRef, ws: WSContext) {
  const callSid = state.callSidRef();
  const streamCoordinator = getStreamCoordinator();
  
  // Check if stream is active
  if (callSid && streamCoordinator.isStreamActive(callSid)) {
    // Store interrupt flag in state to check with next prompt
    state.pendingInterrupt = true;
    
    log.info('[relay] interrupt signal received (waiting for prompt)', {
      connectionId: state.connectionId,
      callSid,
    });
    
    // Do NOT abort the stream - let it continue
    // The next prompt message will be queued automatically
  } else {
    // No active stream, handle interrupt normally
    if (abortRef.get()) abortRef.get().abort('interrupt');
    log.info('[relay] interrupt (no active stream)', {
      connectionId: state.connectionId,
      callSid,
    });
  }
}

function startAbort(abortRef: AbortRef) {
  if (abortRef.get()) abortRef.get().abort('superseded');
  abortRef.set(new (globalThis as any).AbortController());
}

function logPromptReceived(text: string, state: RelayState) {
  const turnId = nanoid(6);
  const preview = text.slice(0, 140);
  log.info('[relay] prompt:received', {
    connectionId: state.connectionId,
    callSid: state.callSidRef(),
    turnId,
    len: text.length,
    preview,
  });
  return { turnId, startedAt: Date.now() };
}

function startTimeout(abortRef: AbortRef) {
  const timeoutMs = getEnv().AI_TIMEOUT_MS;
  return setTimeout(() => abortRef.get()?.abort('timeout'), timeoutMs);
}

async function getTextStream(
  state: RelayState,
  userText: string,
  abortRef: AbortRef
) {
  if (state.callSidRef()) {
    const history = sessions.get(state.callSidRef()!) || [];
    const withUser: SimpleMessage[] = [
      ...history,
      { role: 'user', content: userText },
    ];
    const stream = await streamAnswerWithMessages(withUser, {
      abortSignal: abortRef.get().signal,
    });
    sessions.set(state.callSidRef()!, withUser);

    // Use batch writer for user messages too
    if (state.phoneNumber) {
      try {
        const batchWriter = getBatchWriter();
        batchWriter.enqueue(state.callSidRef()!, withUser, false);
        log.debug('[relay] Queued user message to batch', {
          callSid: state.callSidRef(),
        });
      } catch (err) {
        log.error('[relay] Failed to queue user message', err);
      }
    }

    return { stream, usedMessages: true } as const;
  }
  const stream = await streamAnswer(userText, {
    abortSignal: abortRef.get().signal,
  });
  return { stream, usedMessages: false } as const;
}

function logStreamStart(
  isDebug: boolean,
  state: RelayState,
  turnId: string,
  usedMessages: boolean
) {
  if (!isDebug) return;
  log.debug('[relay] prompt:stream-start', {
    connectionId: state.connectionId,
    callSid: state.callSidRef(),
    turnId,
    model: getEnv().AI_MODEL,
    usedMessages,
  });
}

async function sendStream(ws: WSContext, stream: AsyncIterable<string>, state?: RelayState) {
  let chunks = 0;
  let chars = 0;
  let fullResponse = '';
  for await (const chunk of stream) {
    chunks++;
    chars += chunk.length;
    fullResponse += chunk;
    
    // Check if TTS has been stopped by user
    if (state && state.ttsStoppedByUser) {
      // Continue consuming the stream for context, but don't send to client
      continue;
    }
    
    ws.send(JSON.stringify({ type: 'text', token: chunk, last: false }));
  }
  
  // Only send the final message if TTS wasn't stopped
  if (!state || !state.ttsStoppedByUser) {
    ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
  }
  
  // Clear the TTS stopped flag for next response
  if (state && state.ttsStoppedByUser) {
    state.ttsStoppedByUser = false;
  }
  
  return { chunks, chars, fullResponse };
}

function logStreamFinish(
  state: RelayState,
  turnId: string,
  startedAt: number,
  chunks: number,
  chars: number
) {
  const durationMs = Date.now() - startedAt;
  log.info('[relay] prompt:stream-finish', {
    connectionId: state.connectionId,
    callSid: state.callSidRef(),
    turnId,
    chunks,
    chars,
    durationMs,
  });
}

function logStreamError(
  state: RelayState,
  turnId: string,
  startedAt: number,
  err: unknown
) {
  const durationMs = Date.now() - startedAt;
  log.error('[relay] prompt:error', {
    connectionId: state.connectionId,
    callSid: state.callSidRef(),
    turnId,
    durationMs,
    error: (err as any)?.message || String(err),
  });
}
