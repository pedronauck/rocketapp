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
  if (c.req.method === 'POST') {
    try {
      const formData = await c.req.parseBody();
      phoneNumber = (formData.From as string) || '';
      log.info('[twilio] Extracted phone number', { phoneNumber });
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
    welcomeGreeting: env.RELAY_WELCOME_GREETING,
  });
  log.info('[twilio] respondWithTwiML -> replying TwiML with ws URL', {
    wsUrl,
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

        // Mark conversation as ended in database
        if (callSid && phoneNumber) {
          try {
            const db = getDatabase();
            const finalMessages = sessions.get(callSid) || [];
            db.updateConversationMessages(callSid, finalMessages, true); // true = ended
            log.info('[relay] Marked conversation as ended in database', {
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

function handleSetup(parsed: any, state: RelayState) {
  const callSid = parsed?.callSid || null;
  state.setCallSid(callSid);
  if (callSid) {
    sessions.getOrInit(
      callSid,
      [{ role: 'system', content: getEnv().SYSTEM_PROMPT || '' }].filter(
        Boolean
      ) as SimpleMessage[]
    );

    // Create conversation in database if we have a phone number
    if (state.phoneNumber) {
      try {
        const db = getDatabase();
        db.createConversation(callSid, state.phoneNumber);
        log.info('[relay] Created conversation in database', {
          callSid,
          phoneNumber: state.phoneNumber,
        });
      } catch (err) {
        log.error('[relay] Failed to create conversation in database', err);
      }
    }
  }
  log.info('[relay] setup', {
    connectionId: state.connectionId,
    callSid,
    phoneNumber: state.phoneNumber,
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
    const { chunks, chars } = await sendStream(ws, stream);
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

    // Update conversation in database
    if (state.phoneNumber) {
      try {
        const db = getDatabase();
        db.updateConversationMessages(state.callSidRef()!, withUser);
      } catch (err) {
        log.error('[relay] Failed to update conversation messages', err);
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
  for await (const chunk of stream) {
    chunks++;
    chars += chunk.length;
    ws.send(JSON.stringify({ type: 'text', token: chunk, last: false }));
  }
  ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
  return { chunks, chars };
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
