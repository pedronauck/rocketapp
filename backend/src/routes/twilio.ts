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
  const raw = JSON.parse(data);
  return parseKnownMessage(raw) || raw;
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
      return handleInterrupt(state, abortRef);
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
        
        if (caller?.name) {
          // Returning caller - personalized greeting
          callerName = caller.name;
          // Special pronunciation for bdougie
          const displayName = callerName === 'bdougie' ? 'bee dug ee' : callerName;
          
          // Variety of casual system prompts
          const prompts = [
            `You are a friendly Pokédex assistant. The caller is ${callerName} (pronounced "${displayName}"). They just heard a greeting, so jump right in with a casual "So what Pokémon are you curious about?" or similar. Keep it brief and conversational.`,
            `You are a helpful Pokédex assistant. ${callerName} (pronounced "${displayName}") is calling back. Since they were already greeted, just ask casually what Pokémon they want to know about. Be friendly but brief.`,
            `You're the Pokédex assistant. ${callerName} (pronounced "${displayName}") just called and was greeted. Follow up naturally with something like "Which Pokémon should we look up?" Keep it casual and short.`,
            `You are a knowledgeable Pokédex assistant. The caller ${callerName} (pronounced "${displayName}") was just welcomed. Simply ask what Pokémon info they need today. Stay casual and concise.`,
            `You're helping ${callerName} (pronounced "${displayName}") with Pokémon information. They just heard a greeting, so get right to it - ask what Pokémon they're interested in. Keep it friendly and brief.`
          ];
          
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
    (state as any).callerName = callerName;
    (state as any).isNewCaller = !callerName;
  }
  
  log.info('[relay] setup', { 
    connectionId: state.connectionId, 
    callSid,
    phoneNumber: state.phoneNumber,
    isNewCaller: !(state as any).callerName
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
  
  // Check if this is a new caller and try to extract their name
  if ((state as any).isNewCaller && !(state as any).nameExtracted) {
    const extractedName = extractNameFromResponse(text);
    if (extractedName && state.phoneNumber) {
      try {
        const db = getDatabase();
        await db.saveCallerName(state.phoneNumber, extractedName);
        (state as any).callerName = extractedName;
        (state as any).nameExtracted = true;
        log.info('[relay] Extracted and saved caller name', { 
          name: extractedName, 
          phoneNumber: state.phoneNumber 
        });
        
        // Update the session's system prompt to reflect we now know their name
        const callSid = state.callSidRef();
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
    const { chunks, chars, fullResponse } = await sendStream(ws, stream);
    
    // Save assistant response to session and database
    if (state.callSidRef() && fullResponse) {
      const history = sessions.get(state.callSidRef()!) || [];
      const withAssistant: SimpleMessage[] = [
        ...history,
        { role: 'assistant', content: fullResponse },
      ];
      sessions.set(state.callSidRef()!, withAssistant);
      
      // Use batch writer for efficient database updates
      if (state.phoneNumber) {
        try {
          const batchWriter = getBatchWriter();
          batchWriter.enqueue(state.callSidRef()!, withAssistant, false);
          log.debug('[relay] Queued conversation update with assistant response', {
            callSid: state.callSidRef(),
            messageCount: withAssistant.length,
          });
        } catch (err) {
          log.error('[relay] Failed to queue conversation update', err);
        }
      }
    }
    
    logStreamFinish(state, turnId, startedAt, chunks, chars);
  } catch (err) {
    logStreamError(state, turnId, startedAt, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function handleInterrupt(state: RelayState, abortRef: AbortRef) {
  if (abortRef.get()) abortRef.get().abort('interrupt');
  log.info('[relay] interrupt', {
    connectionId: state.connectionId,
    callSid: state.callSidRef(),
  });
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

async function sendStream(ws: WSContext, stream: AsyncIterable<string>) {
  let chunks = 0;
  let chars = 0;
  let fullResponse = '';
  for await (const chunk of stream) {
    chunks++;
    chars += chunk.length;
    fullResponse += chunk;
    ws.send(JSON.stringify({ type: 'text', token: chunk, last: false }));
  }
  ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
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
