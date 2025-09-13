import type { Hono } from 'hono';
import type { UpgradeWebSocket, WSContext, WSMessageReceive } from 'hono/ws';
import { nanoid } from 'nanoid';
import { generateTwiML, generateMessagingTwiML } from '../utils/twiml';
import {
  streamAnswer,
  streamAnswerWithMessages,
  type SimpleMessage,
  identifyPokemonFromImageUrl,
} from '../services/ai';
import { validateTwilioSignature } from '../utils/twilio-signature';
import { getEnv } from '../config/env';
import { log } from '../utils/log';
import { sessions } from '../services/session';
import { parseKnownMessage } from '../types/relay';
import {
  getRandomThinkingMessage,
  getRandomImageProcessingMessage,
} from '../utils/thinking-messages';
import type { Context } from 'hono';
import { getDatabase } from '../db/database';
import { getBatchWriter } from '../services/batch-writer';
import { decideForPrompt, decideForImage } from '../services/reasoner';
import { getMessageQueue } from '../services/message-queue';
import { getStreamCoordinator } from '../services/stream-coordinator';

// ----------------------------------------------------------------------------
// Live Call Registry: track active calls by caller phone and callSid, so that
// inbound media (SMS/WhatsApp) can trigger speech back into the ongoing call.
// ----------------------------------------------------------------------------
type CallChannel = {
  ws: WSContext;
  phoneNumber: string | null;
  callSid: string | null;
  waitingForImage: boolean;
  waitTimer?: ReturnType<typeof setTimeout> | null;
  lastReminderTime?: number; // Track when we last sent a reminder
};

const activeCallsByPhone = new Map<string, CallChannel>();

function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const s = p.trim();
  return s.toLowerCase().startsWith('whatsapp:')
    ? s.slice('whatsapp:'.length)
    : s;
}

// Intent heuristics moved to AI reasoner (services/reasoner.ts)

function setWaitingForImage(ch: CallChannel, ms = 120000) {
  ch.waitingForImage = true;
  // Reset reminder time when starting to wait for image
  ch.lastReminderTime = undefined;
  if (ch.waitTimer) clearTimeout(ch.waitTimer);
  ch.waitTimer = setTimeout(() => {
    if (!ch.ws) return;
    try {
      ch.ws.send(
        JSON.stringify({
          type: 'text',
          token:
            "I didn't receive a photo in time. If you'd like, say 'check my Pokémon photo' again and send it now.",
          last: true,
        })
      );
    } catch {}
    ch.waitingForImage = false;
    ch.waitTimer = null;
  }, ms);

  log.info('[twilio] setWaitingForImage: now waiting for image', {
    phoneNumber: ch.phoneNumber,
    callSid: ch.callSid,
    timeoutMs: ms,
  });
}

function clearWaitingForImage(ch: CallChannel) {
  const wasWaiting = ch.waitingForImage;
  ch.waitingForImage = false;
  ch.lastReminderTime = undefined; // Reset reminder time
  if (ch.waitTimer) {
    clearTimeout(ch.waitTimer);
    ch.waitTimer = null;
  }

  if (wasWaiting) {
    log.info('[twilio] clearWaitingForImage: stopped waiting for image', {
      phoneNumber: ch.phoneNumber,
      callSid: ch.callSid,
    });
  }
}

function chunkText(text: string, size = 240): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    out.push(text.slice(i, i + size));
    i += size;
  }
  return out;
}

// Utility function to clean special characters and markdown from AI responses
function cleanSpecialCharacters(text: string): string {
  const original = text;
  let cleaned = text;

  // Remove markdown formatting and list markers
  cleaned = cleaned.replace(/^[\s]*[-\*\+]\s+/gm, ''); // Remove bullet points at start of lines
  cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, ''); // Remove numbered lists
  cleaned = cleaned.replace(/\*\*(.*?)\*\*/g, '$1'); // Remove bold markdown
  cleaned = cleaned.replace(/\*(.*?)\*/g, '$1'); // Remove italic markdown
  cleaned = cleaned.replace(/`(.*?)`/g, '$1'); // Remove inline code
  cleaned = cleaned.replace(/```[\s\S]*?```/g, ''); // Remove code blocks
  cleaned = cleaned.replace(/#{1,6}\s+/g, ''); // Remove headers
  cleaned = cleaned.replace(/^\s*>\s+/gm, ''); // Remove blockquotes

  // Remove special characters
  cleaned = cleaned.replace(/[*\/\\$@%&+=|^<>[\]{}~#]/g, ''); // Remove special chars

  // Normalize multiple spaces and clean up
  cleaned = cleaned.replace(/\s+/g, ' '); // Normalize spaces
  cleaned = cleaned.replace(/\n+/g, ' '); // Replace newlines with spaces
  cleaned = cleaned.trim();

  // Log if we cleaned anything
  if (original !== cleaned) {
    log.debug(
      '[twilio] cleanSpecialCharacters: cleaned formatting and special characters',
      {
        originalLength: original.length,
        cleanedLength: cleaned.length,
        originalPreview: original.substring(0, 50) + '...',
        cleanedPreview: cleaned.substring(0, 50) + '...',
      }
    );
  }

  return cleaned;
}

function speakToCall(ch: CallChannel, message: string) {
  try {
    // Clean any special characters from the message
    const cleanedMessage = cleanSpecialCharacters(message);

    log.debug('[twilio] speakToCall: sending message', {
      originalLength: message.length,
      cleanedLength: cleanedMessage.length,
      messagePreview: cleanedMessage.substring(0, 50) + '...',
      phoneNumber: ch.phoneNumber,
      callSid: ch.callSid,
      chunks: Math.ceil(cleanedMessage.length / 240),
    });

    const chunks = chunkText(cleanedMessage);
    chunks.forEach((token, idx) => {
      ch.ws.send(
        JSON.stringify({ type: 'text', token, last: idx === chunks.length - 1 })
      );
    });

    log.debug('[twilio] speakToCall: message sent successfully', {
      totalChunks: chunks.length,
      phoneNumber: ch.phoneNumber,
      callSid: ch.callSid,
    });
  } catch (error) {
    log.error('[twilio] speakToCall: failed to send message', {
      error: (error as any)?.message || String(error),
      messageLength: message.length,
      phoneNumber: ch.phoneNumber,
      callSid: ch.callSid,
    });
    throw error;
  }
}

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
  registerMessagingRoute(app, env);
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

function registerMessagingRoute(app: Hono, env: ReturnType<typeof getEnv>) {
  // Twilio will POST application/x-www-form-urlencoded
  app.post('/twilio/messaging', async (c) => {
    const ok = await validateSignatureIfConfigured(c, env);
    if (!ok)
      return c.json(
        { error: 'unauthorized', message: 'Invalid Twilio signature' },
        401
      );

    let form: Record<string, string | Blob | File | undefined> = {};
    try {
      form = (await c.req.parseBody()) as any;
    } catch (err) {
      log.error('[twilio] messaging: failed to parse form body', err);
      return c.json(
        { error: 'bad_request', message: 'Invalid form data' },
        400
      );
    }

    const from = (form.From as string) || '';
    const body = ((form.Body as string) || '').trim();
    const numMedia = parseInt(String(form.NumMedia || '0'), 10) || 0;

    // Prefer media URL provided by Twilio when present and is an image
    let imageUrl: string | null = null;
    if (numMedia > 0) {
      try {
        for (let i = 0; i < numMedia; i++) {
          const url = form[`MediaUrl${i}`] as string | undefined;
          const ct = (form[`MediaContentType${i}`] as string | undefined) || '';
          if (url && /^https?:\/\//i.test(url) && /^image\//i.test(ct)) {
            imageUrl = url;
            break;
          }
        }
      } catch (err) {
        // ignore and fallback to body
      }
    }

    // If no Twilio media, check if body carries an image URL or base64 data URL
    if (!imageUrl && body) {
      const urlMatch = body.match(/https?:\/\/\S+/i);
      if (urlMatch) {
        imageUrl = urlMatch[0];
      }
    }

    // If body looks like base64 (with or without data URL prefix), save locally
    let localUrl: string | null = null;
    if (!imageUrl && body) {
      const dataUrlMatch = body.match(
        /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
      );
      if (dataUrlMatch) {
        const mime = dataUrlMatch[1];
        const b64 = dataUrlMatch[2];
        localUrl = await saveBase64ImageAndGetUrl(b64, mime, env);
      } else if (/^[A-Za-z0-9+/=\n\r]+$/.test(body) && body.length > 100) {
        // Heuristic: looks like raw base64, assume PNG
        localUrl = await saveBase64ImageAndGetUrl(body, 'image/png', env);
      }
    }

    const finalImageUrl = imageUrl || localUrl;

    // If there is an active call for this sender, prefer voice-only handling
    const normFrom = normalizePhone(from);
    const active = normFrom ? activeCallsByPhone.get(normFrom) : undefined;
    if (active && !finalImageUrl) {
      try {
        speakToCall(
          active,
          "I didn't receive an image. Please text your Pokémon photo to this number and I'll analyze it."
        );
      } catch {}
      const ackNone = `<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>`;
      log.info(
        '[twilio] messaging: active call but no image; notified on call',
        {
          from,
        }
      );
      return c.text(ackNone, 200, { 'Content-Type': 'text/xml' });
    }
    if (!finalImageUrl) {
      const xml = generateMessagingTwiML(
        'Please send an image (or an image URL).'
      );
      log.info('[twilio] messaging: no image found in message', { from });
      return c.text(xml, 200, { 'Content-Type': 'text/xml' });
    }

    // If there is an active call for this sender, speak the result on the call
    if (active) {
      // Return empty TwiML so Twilio does NOT send any message back
      const ack = `<?xml version="1.0" encoding="UTF-8"?><Response/>`;

      // Immediate voice feedback that photo was received
      try {
        const immediateFeedback = getRandomImageProcessingMessage();
        speakToCall(active, immediateFeedback);
        log.info('[twilio] messaging: sent immediate photo received feedback', {
          message: immediateFeedback.substring(0, 50) + '...',
          phoneNumber: active.phoneNumber,
          callSid: active.callSid,
        });
      } catch (feedbackError) {
        log.error('[twilio] messaging: failed to send immediate feedback', {
          error: (feedbackError as any)?.message || String(feedbackError),
          phoneNumber: active.phoneNumber,
          callSid: active.callSid,
        });
      }

      // Small delay to ensure proper message sequencing
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Process and speak back on the call without sending an SMS with the result
      void (async () => {
        log.info('[twilio] messaging: starting async image processing', {
          phoneNumber: active.phoneNumber,
          callSid: active.callSid,
          imageUrl: finalImageUrl?.substring(0, 100) + '...',
        });

        try {
          // Send a processing message while analyzing
          try {
            const processingMessage = getRandomThinkingMessage();
            // Small delay before processing message
            await new Promise((resolve) => setTimeout(resolve, 300));
            speakToCall(active, processingMessage);
            log.info('[twilio] messaging: sent processing message', {
              message: processingMessage.substring(0, 50) + '...',
            });
          } catch (processingError) {
            log.warn('[twilio] messaging: failed to send processing message', {
              error:
                (processingError as any)?.message || String(processingError),
            });
          }

          // Add timeout to image processing
          log.info('[twilio] messaging: starting pokemon vision analysis');
          const analysisPromise = runPokemonVision(finalImageUrl);
          const timeoutPromise = new Promise<string>((_, reject) =>
            setTimeout(
              () =>
                reject(new Error('Image analysis timeout after 30 seconds')),
              30000
            )
          );

          const analysis = await Promise.race([
            analysisPromise,
            timeoutPromise,
          ]);
          log.info('[twilio] messaging: pokemon vision analysis completed', {
            analysisLength: analysis?.length || 0,
            analysisPreview: analysis?.substring(0, 100) + '...',
          });

          // Personalize the spoken result slightly via the AI reasoner
          let callerName: string | null = null;
          try {
            if (active.phoneNumber) {
              const db = getDatabase();
              const caller = await db.getCallerQuickly(active.phoneNumber, 150);
              callerName = caller?.name || null;
              log.debug('[twilio] messaging: retrieved caller name', {
                callerName,
              });
            }
          } catch (dbError) {
            log.warn('[twilio] messaging: failed to retrieve caller name', {
              error: (dbError as any)?.message || String(dbError),
            });
          }

          log.info('[twilio] messaging: calling decideForImage reasoner');
          const { reply } = await decideForImage({
            analysis,
            waitingForImage: !!active.waitingForImage,
            callerName,
          });
          log.info('[twilio] messaging: reasoner completed', {
            replyLength: reply?.length || 0,
            replyPreview: reply?.substring(0, 100) + '...',
          });

          // Clear waiting state and speak back
          log.info(
            '[twilio] messaging: clearing waiting state and speaking reply'
          );

          // Small delay before final result to ensure processing message is heard
          await new Promise((resolve) => setTimeout(resolve, 500));

          clearWaitingForImage(active);
          // Reset reminder time so future image requests can send reminders again
          active.lastReminderTime = undefined;
          speakToCall(active, reply);

          // Persist assistant reply in session/history if possible
          const sid = active.callSid;
          if (sid) {
            const history = sessions.get(sid) || [];
            const withAssistant: SimpleMessage[] = [
              ...history,
              { role: 'assistant', content: reply },
            ];
            sessions.set(sid, withAssistant);
            try {
              const batchWriter = getBatchWriter();
              batchWriter.enqueue(sid, withAssistant, false);
              log.debug('[twilio] messaging: queued assistant reply to batch', {
                callSid: sid,
              });
            } catch (err) {
              log.error(
                '[twilio] messaging: failed to queue assistant reply',
                err
              );
            }
          }

          log.info('[twilio] messaging: spoke result on active call', {
            phone: active.phoneNumber,
            callSid: active.callSid,
          });
        } catch (err) {
          const errorMessage = (err as any)?.message || String(err);
          log.error('[twilio] messaging: async processing for call failed', {
            error: errorMessage,
            phoneNumber: active.phoneNumber,
            callSid: active.callSid,
            imageUrl: finalImageUrl?.substring(0, 100) + '...',
            stack: (err as any)?.stack,
          });

          // Clear waiting state on error
          try {
            clearWaitingForImage(active);
            log.info('[twilio] messaging: cleared waiting state due to error');
          } catch (clearError) {
            log.warn('[twilio] messaging: failed to clear waiting state', {
              error: (clearError as any)?.message || String(clearError),
            });
          }

          // Try to speak error message
          try {
            const errorReply = errorMessage.includes('timeout')
              ? 'Sorry, the image analysis took too long. Please try sending a smaller or clearer photo.'
              : 'Sorry, I had trouble analyzing that image. Please try again with a different photo.';

            speakToCall(active, errorReply);
            log.info('[twilio] messaging: sent error message to caller', {
              errorReply: errorReply.substring(0, 50) + '...',
            });
          } catch (speakError) {
            log.error('[twilio] messaging: failed to speak error message', {
              error: (speakError as any)?.message || String(speakError),
            });
          }
        }
      })();

      return c.text(ack, 200, { 'Content-Type': 'text/xml' });
    }

    // No active call: do not reply via SMS/WhatsApp due to Twilio limitation
    const noReply = `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
    log.warn(
      '[twilio] messaging: no active call found; not replying via messaging',
      {
        from,
        imageUrl: finalImageUrl,
      }
    );
    return c.text(noReply, 200, { 'Content-Type': 'text/xml' });
  });
}

async function saveBase64ImageAndGetUrl(
  base64: string,
  mime: string,
  env: ReturnType<typeof getEnv>
) {
  const clean = base64.replace(/\s/g, '');
  const buf = Buffer.from(clean, 'base64');
  const id = nanoid(10);
  const ext = mime.split('/')[1] || 'png';
  const dir = './uploads/img';
  const path = `${dir}/${id}.${ext}`;
  await ensureDir(dir);
  await Bun.write(path, buf);
  const port = env.PORT;
  return `http://localhost:${port}/img/${id}.${ext}`;
}

async function ensureDir(path: string) {
  const fs = await import('node:fs');
  const p = await import('node:path');
  const full = p.resolve(path);
  if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
}

async function runPokemonVision(imageUrl: string): Promise<string> {
  log.info('[twilio] messaging: calling identifyPokemonFromImageUrl', {
    imageUrl: imageUrl.substring(0, 100) + '...',
  });

  try {
    const result = await identifyPokemonFromImageUrl(imageUrl);
    log.info('[twilio] messaging: identifyPokemonFromImageUrl completed', {
      resultLength: result?.length || 0,
      resultPreview: result?.substring(0, 100) + '...',
    });
    return result;
  } catch (error) {
    log.error('[twilio] messaging: identifyPokemonFromImageUrl failed', {
      error: (error as any)?.message || String(error),
      imageUrl: imageUrl.substring(0, 100) + '...',
      stack: (error as any)?.stack,
    });
    throw error;
  }
}

async function respondWithTwiML(c: Context, env: ReturnType<typeof getEnv>) {
  // Extract phone number from Twilio POST data
  let phoneNumber = '';
  let welcomeGreeting =
    env.RELAY_WELCOME_GREETING || 'Welcome to the Pokédex Call Center.';

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
            const displayName =
              caller.name === 'bdougie' ? 'bee dug ee' : caller.name;

            // Array of greeting variations
            const greetings = [
              `Sup ${displayName}! What Pokémon can I help you with today?`,
              `Yo ${displayName}, good to hear from you! Which Pokémon are we looking up today?`,
              `Hey ${displayName}, welcome back! What Pokémon info do you need?`,
              `${displayName}! Great to hear from you again. What Pokémon should we explore?`,
              `What's up ${displayName}? Ready to dive into some Pokémon facts?`,
            ];

            // Pick a random greeting
            welcomeGreeting =
              greetings[Math.floor(Math.random() * greetings.length)];
            log.info('[twilio] Personalized greeting for returning caller', {
              name: caller.name,
              greeting: welcomeGreeting,
            });
          } else {
            welcomeGreeting =
              'Welcome to the Pokédex Call Center. May I have your name please?';
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
  log.info('[twilio] respondWithTwiML -> replying TwiML with ws URL', {
    wsUrl,
    welcomeGreeting,
  });
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
      const name =
        match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
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
    let systemPrompt =
      getEnv().SYSTEM_PROMPT || 'You are a helpful Pokédex assistant.';
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
            const messages = JSON.parse(
              existingConv.messages
            ) as SimpleMessage[];
            if (messages.length > 0) {
              sessions.set(callSid, messages);
              log.info('[relay] Recovered conversation from database', {
                callSid,
                messageCount: messages.length,
              });
            }
          } catch (parseErr) {
            log.error('[relay] Failed to parse recovered messages', parseErr);
          }
        } else {
          // Check for recent unclosed conversation (within last 5 minutes)
          const recentConvs = await db.getRecentConversation(
            state.phoneNumber,
            1
          );
          if (recentConvs.length > 0 && !recentConvs[0].ended_at) {
            const timeSinceStart = recentConvs[0].started_at
              ? Date.now() / 1000 - recentConvs[0].started_at
              : Infinity;
            if (timeSinceStart < 300) {
              // 5 minutes
              try {
                const messages = JSON.parse(
                  recentConvs[0].messages
                ) as SimpleMessage[];
                if (messages.length > 0) {
                  // Recover context from previous unclosed conversation
                  sessions.set(callSid, messages);
                  log.info('[relay] Recovered recent unclosed conversation', {
                    oldCallSid: recentConvs[0].call_sid,
                    newCallSid: callSid,
                    messageCount: messages.length,
                    ageSeconds: Math.round(timeSinceStart),
                  });
                }
              } catch (parseErr) {
                log.error(
                  '[relay] Failed to parse recent conversation messages',
                  parseErr
                );
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
          const displayName =
            callerName === 'bdougie' ? 'bee dug ee' : callerName;

          // Get conversation context if available
          let contextInfo = '';
          if (contextPromise) {
            try {
              const context = await Promise.race([
                contextPromise,
                new Promise((resolve) => setTimeout(() => resolve(null), 150)), // 150ms timeout
              ]);

              if (
                context &&
                (context.recentTopics?.length > 0 ||
                  context.conversationCount > 0)
              ) {
                const timeSinceLastCall = context.lastCallTime
                  ? Math.floor(
                      (Date.now() / 1000 - context.lastCallTime) / 3600
                    )
                  : null;

                // Build context string
                if (context.recentTopics.length > 0) {
                  contextInfo = ` Recently, they've asked about ${context.recentTopics.join(', ')}.`;
                }

                if (timeSinceLastCall !== null && timeSinceLastCall < 1) {
                  contextInfo += ' They called less than an hour ago.';
                } else if (
                  timeSinceLastCall !== null &&
                  timeSinceLastCall < 24
                ) {
                  contextInfo += ` They last called ${timeSinceLastCall} hours ago.`;
                }

                log.info('[relay] Added conversation context', {
                  phoneNumber: state.phoneNumber,
                  topics: context.recentTopics,
                  conversationCount: context.conversationCount,
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
            `You're helping ${callerName} (pronounced "${displayName}") with Pokémon information.${contextInfo} They just heard a greeting, so get right to it - ask what Pokémon they're interested in. Keep it friendly and brief.`,
          ];

          // If they've talked about specific Pokemon recently, we can reference them
          if (contextInfo.includes('Recently')) {
            const contextAwarePrompts = [
              `You are a friendly Pokédex assistant. ${callerName} is back!${contextInfo} They were just greeted. You can reference their previous interests if relevant, or help with something new. Keep it natural and brief.`,
              `You're the Pokédex assistant helping ${callerName}.${contextInfo} After the greeting, see if they want to continue exploring those topics or learn about something new. Stay conversational.`,
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
    sessions.getOrInit(callSid, [
      { role: 'system', content: systemPrompt },
    ] as SimpleMessage[]);

    // Store caller info in state for later use
    state.callerName = callerName || undefined;
    state.isNewCaller = !callerName;
  }

  log.info('[relay] setup', {
    connectionId: state.connectionId,
    callSid,
    phoneNumber: state.phoneNumber,
    isNewCaller: !state.callerName,
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

  // Check if we're waiting for an image - if so, ignore all voice input
  const norm = normalizePhone(state.phoneNumber);
  const ch = norm ? activeCallsByPhone.get(norm) : undefined;

  if (ch?.waitingForImage) {
    log.info(
      '[relay] handlePrompt: ignoring voice input while waiting for image',
      {
        phoneNumber: state.phoneNumber,
        callSid: state.callSidRef(),
        voiceInput: text.substring(0, 50) + '...',
      }
    );

    // Optionally send a brief reminder that we're waiting for image (max once per 30 seconds)
    const now = Date.now();
    const lastReminder = ch.lastReminderTime || 0;
    const timeSinceLastReminder = now - lastReminder;

    if (timeSinceLastReminder > 30000) {
      // 30 seconds
      try {
        speakToCall(
          ch,
          "I'm waiting for your Pokémon photo. Please send it via text message."
        );
        ch.lastReminderTime = now;
        log.debug(
          '[relay] handlePrompt: sent reminder about waiting for image'
        );
      } catch (reminderError) {
        log.warn('[relay] handlePrompt: failed to send reminder', {
          error: (reminderError as any)?.message || String(reminderError),
        });
      }
    } else {
      log.debug(
        '[relay] handlePrompt: skipped reminder (too soon since last one)',
        {
          secondsSinceLastReminder: Math.round(timeSinceLastReminder / 1000),
        }
      );
    }

    return; // Ignore all voice input while waiting for image
  }

  const callSid = state.callSidRef();
  const streamCoordinator = getStreamCoordinator();
  const messageQueue = getMessageQueue();

  // Check if this is a stop command
  const isStopCommand =
    text.toLowerCase().trim() === 'stop' ||
    text.toLowerCase().includes('stop talking') ||
    text.toLowerCase().includes('stop speaking');

  // Check if stream is currently active
  if (callSid && streamCoordinator.isStreamActive(callSid)) {
    if (isStopCommand) {
      // User said "stop" - send stop signal to client to halt TTS
      // but don't abort the stream (let it finish internally for context)
      ws.send(JSON.stringify({ type: 'stop' }));

      log.info(
        '[relay] TTS stopped by user command (stream continues internally)',
        {
          connectionId: state.connectionId,
          callSid,
          command: text,
        }
      );

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

  // Get the call channel for decision logic
  const norm = normalizePhone(state.phoneNumber);
  const ch = norm ? activeCallsByPhone.get(norm) : undefined;

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
          phoneNumber: state.phoneNumber,
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

  // Normal voice processing when not waiting for image
  try {
    const decision = await decideForPrompt({
      channel: 'voice',
      text,
      waitingForImage: !!ch?.waitingForImage,
      callerName: state.callerName || null,
      isNewCaller: !!state.isNewCaller,
    });
    log.debug('[relay] reasoner:decision', {
      action: decision.action,
      hasName: !!decision.extractedName,
    });

    // Persist name if extracted for new callers
    if (decision.extractedName && state.isNewCaller && state.phoneNumber) {
      try {
        const db = getDatabase();
        await db.saveCallerName(state.phoneNumber, decision.extractedName);
        state.callerName = decision.extractedName;
        state.isNewCaller = false;
        state.nameExtracted = true;
        const callSid = state.callSidRef();

        if (callSid) {
          const history = sessions.get(callSid) || [];
          if (history.length > 0 && history[0].role === 'system') {
            history[0].content = `You are a helpful Pokédex assistant. The caller's name is ${decision.extractedName}. You've just learned their name, so acknowledge it warmly and continue helping with their Pokémon questions.`;
            sessions.set(callSid, history);
          }
        }
        log.info('[relay] Saved caller name from user utterance', {
          name: decision.extractedName,
          phoneNumber: state.phoneNumber,
        });
      } catch (err) {
        log.error('[relay] Failed to save caller name', err);
      }
    }

    // If decision is not to chat, act immediately and return
    if (decision.action === 'wait_for_image' && ch) {
      setWaitingForImage(ch);
      speakToCall(ch, decision.reply);

      // Record assistant reply in session
      if (state.callSidRef()) {
        const history = sessions.get(state.callSidRef()!) || [];
        const withAssistant: SimpleMessage[] = [
          ...history,
          { role: 'assistant', content: decision.reply },
        ];
        sessions.set(state.callSidRef()!, withAssistant);
        try {
          const batchWriter = getBatchWriter();
          batchWriter.enqueue(state.callSidRef()!, withAssistant, false);
        } catch {}
      }
      return;
    }

    if (decision.action === 'cancel_wait' && ch) {
      clearWaitingForImage(ch);
      speakToCall(ch, decision.reply);
      if (state.callSidRef()) {
        const history = sessions.get(state.callSidRef()!) || [];
        const withAssistant: SimpleMessage[] = [
          ...history,
          { role: 'assistant', content: decision.reply },
        ];
        sessions.set(state.callSidRef()!, withAssistant);
        try {
          const batchWriter = getBatchWriter();
          batchWriter.enqueue(state.callSidRef()!, withAssistant, false);
        } catch {}
      }
      return;
    }

    if (decision.action === 'ack_name_only' && ch) {
      speakToCall(ch, decision.reply);
      if (state.callSidRef()) {
        const history = sessions.get(state.callSidRef()!) || [];
        const withAssistant: SimpleMessage[] = [
          ...history,
          { role: 'assistant', content: decision.reply },
        ];
        sessions.set(state.callSidRef()!, withAssistant);
        try {
          const batchWriter = getBatchWriter();
          batchWriter.enqueue(state.callSidRef()!, withAssistant, false);
        } catch {}
      }
      return;
    }
  } catch (err) {
    log.warn('[relay] reasoner failed; proceeding with chat', err);
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
          log.debug(
            '[relay] Queued conversation update with assistant response',
            {
              callSid,
              messageCount: withAssistant.length,
            }
          );
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
    await new Promise((resolve) => setTimeout(resolve, 500));

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

function handleInterrupt(
  state: RelayState,
  abortRef: AbortRef,
  _ws: WSContext
) {
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

async function sendStream(
  ws: WSContext,
  stream: AsyncIterable<string>,
  state?: RelayState
) {
  let chunks = 0;
  let chars = 0;
  let fullResponse = '';
  for await (const chunk of stream) {
    // Clean special characters from each chunk
    const cleanedChunk = cleanSpecialCharacters(chunk);
    if (cleanedChunk) {
      // Only send non-empty chunks
      chunks++;
      chars += cleanedChunk.length;
      fullResponse += cleanedChunk;

      // Check if TTS has been stopped by user
      if (state && state.ttsStoppedByUser) {
        // Continue consuming the stream for context, but don't send to client
        continue;
      }

      ws.send(
        JSON.stringify({ type: 'text', token: cleanedChunk, last: false })
      );
    }
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
