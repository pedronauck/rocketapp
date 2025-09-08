import type { Hono } from 'hono';
import type { UpgradeWebSocket, WSContext, WSMessageReceive } from 'hono/ws';
import { nanoid } from 'nanoid';
import { generateTwiML } from '../utils/twiml';
import { streamAnswer, streamAnswerWithMessages, type SimpleMessage } from '../services/ai';
import { validateTwilioSignature } from '../utils/twilio-signature';


// Helpers
function resolveRelayWsUrl(req: Request): string {
  const envUrl = process.env.RELAY_WS_URL;
  if (envUrl) return envUrl;

  // Derive from incoming request host; default to ws for local
  const url = new URL(req.url);
  const scheme = url.protocol === 'https:' ? 'wss' : 'ws';
  const host = url.host; // includes port
  return `${scheme}://${host}/twilio/relay`;
}

type UpgradeWS = UpgradeWebSocket;

export function registerTwilioRoutes(app: Hono, upgradeWebSocket: UpgradeWS) {
  // Simple in-memory session store keyed by callSid
  const sessions = new Map<string, SimpleMessage[]>();
  const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
  const isDebug = LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace';

  // GET TwiML endpoint aligning with Twilio tutorial
  app.get('/twiml', async (c) => {
    const domain = process.env.NGROK_URL; // e.g., abcd1234.ngrok-free.app (no scheme)
    const wsUrl = domain
      ? `wss://${domain}/ws`
      : resolveRelayWsUrl(c.req.raw).replace('/twilio/relay', '/ws');

    const welcome =
      process.env.RELAY_WELCOME_GREETING ||
      'Hi! I am a voice assistant powered by Twilio. Ask me anything!';

    const xml = generateTwiML({ websocketUrl: wsUrl, welcomeGreeting: welcome });
    console.log('[twilio] GET /twiml -> replying TwiML with ws URL');
    return c.text(xml, 200, { 'Content-Type': 'text/xml' });
  });
  // Webhook that Twilio hits for an incoming call
  app.post('/twilio/voice', async (c) => {
    // Optional Twilio signature validation
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      let formParams: Record<string, string | Blob | File | undefined> | undefined;
      const contentType = c.req.header('content-type') || '';
      // Only parse form body for application/x-www-form-urlencoded
      if (contentType.includes('application/x-www-form-urlencoded')) {
        formParams = (await c.req.parseBody()) as Record<string, string | Blob | File | undefined>;
      }
      const reqUrl = new URL(c.req.url);
      const host = c.req.header('host') || reqUrl.host;
      const protoHdr = c.req.header('x-forwarded-proto');
      const proto = (protoHdr || reqUrl.protocol.replace(':', '')).toLowerCase();
      const urlForSig = `${proto}://${host}${reqUrl.pathname}${reqUrl.search}`;

      const ok = validateTwilioSignature({
        url: urlForSig,
        method: c.req.method,
        headers: c.req.raw.headers,
        formParams,
        authToken,
      });
      if (!ok) {
        return c.json({ error: 'unauthorized', message: 'Invalid Twilio signature' }, 401);
      }
    }
    const wsUrl = resolveRelayWsUrl(c.req.raw);

    const welcome =
      process.env.RELAY_WELCOME_GREETING ||
      'Hi! Welcome to the Pokédex Call Center. Ask me about any Pokémon!';

    const xml = generateTwiML({ websocketUrl: wsUrl, welcomeGreeting: welcome });
    console.log('[twilio] POST /twilio/voice -> replying TwiML with ws URL');
    return c.text(xml, 200, {
      'Content-Type': 'text/xml',
    });
  });

  // Twilio Conversation Relay WebSocket endpoint
  const makeRelayHandler = () =>
    upgradeWebSocket((_c: unknown) => {
      // Per-connection abort controller for streaming tasks
      let currentAbort: any = null;
      let callSid: string | null = null;
      const connectionId = nanoid(6);

      return {
        onOpen(_evt: Event, _ws: WSContext) {
          console.log('[relay] open', { connectionId });
        },
        async onMessage(event: MessageEvent<WSMessageReceive>, ws: WSContext) {
          try {
            const data = typeof event.data === 'string' ? event.data : '';
            if (!data) return;

            const msg = JSON.parse(data);
            const type = msg?.type;
            switch (type) {
              case 'setup': {
                callSid = msg.callSid || null;
                if (callSid && !sessions.has(callSid)) {
                  sessions.set(callSid, [
                    { role: 'system', content: process.env.SYSTEM_PROMPT || '' },
                  ].filter((m) => m.content) as SimpleMessage[]);
                }
                console.log('[relay] setup', { connectionId, callSid });
                return;
              }
              case 'prompt': {
                const userText: string = msg.voicePrompt || msg.text || '';
                if (!userText) return;

                // Abort previous stream if any
                if (currentAbort) currentAbort.abort('superseded');
                currentAbort = new (globalThis as any).AbortController();

                let timer: ReturnType<typeof setTimeout> | undefined;
                const startedAt = Date.now();
                const turnId = nanoid(6);
                const preview = userText.slice(0, 140);
                console.log('[relay] prompt:received', {
                  connectionId,
                  callSid,
                  turnId,
                  len: userText.length,
                  preview,
                });
                try {
                  const timeoutMs = Number(process.env.AI_TIMEOUT_MS || 20000);
                  timer = setTimeout(() => currentAbort?.abort('timeout'), timeoutMs);

                  // If we have a session, include conversation history
                  let textStream: AsyncIterable<string>;
                  let usedMessages = false;
                  if (callSid && sessions.has(callSid)) {
                    const history = sessions.get(callSid)!;
                    const withUser: SimpleMessage[] = [
                      ...history,
                      { role: 'user', content: userText },
                    ];
                    textStream = await streamAnswerWithMessages(withUser, {
                      abortSignal: currentAbort.signal,
                    });
                    usedMessages = true;
                    // Append assistant text after stream finishes (collecting would add latency); we skip persisting assistant chunk-by-chunk.
                    // Optionally, we could buffer into a small string to store minimal assistant history.
                    // For now, update history with the last user turn only.
                    sessions.set(callSid, withUser);
                  } else {
                    textStream = await streamAnswer(userText, {
                      abortSignal: currentAbort.signal,
                    });
                  }

                  const model = process.env.AI_MODEL || 'gpt-4o-mini';
                  if (isDebug) {
                    console.log('[relay] prompt:stream-start', {
                      connectionId,
                      callSid,
                      turnId,
                      model,
                      usedMessages,
                    });
                  }

                  let chunks = 0;
                  let chars = 0;
                  for await (const chunk of textStream) {
                    chunks++;
                    chars += chunk.length;
                    ws.send(
                      JSON.stringify({ type: 'text', token: chunk, last: false })
                    );
                  }
                  // final chunk marker
                  ws.send(JSON.stringify({ type: 'text', token: '', last: true }));
                  const durationMs = Date.now() - startedAt;
                  console.log('[relay] prompt:stream-finish', {
                    connectionId,
                    callSid,
                    turnId,
                    chunks,
                    chars,
                    durationMs,
                  });
                } catch (err) {
                  const durationMs = Date.now() - startedAt;
                  console.error('[relay] prompt:error', {
                    connectionId,
                    callSid,
                    turnId,
                    durationMs,
                    error: (err as any)?.message || String(err),
                  });
                } finally {
                  if (timer) clearTimeout(timer);
                }
                return;
              }
              case 'interrupt': {
                if (currentAbort) currentAbort.abort('interrupt');
                console.log('[relay] interrupt', { connectionId, callSid });
                return;
              }
              case 'ping': {
                ws.send(JSON.stringify({ type: 'pong' }));
                return;
              }
              // Common lifecycle events to acknowledge/log
              case 'start':
              case 'connected':
              case 'keepalive':
              case 'end':
              case 'close':
              case 'media':
                // No-op but useful for debugging
                // console.log('Relay event:', type);
                return;
              default: {
                // Unknown message type; ignore safely
                return;
              }
            }
          } catch (err) {
            console.error('[relay] onMessage:error', {
              error: (err as any)?.message || String(err),
            });
          }
        },
        onError(_event: Event, _ws: WSContext) {
          // console.error('WS onError:', _event?.message || _event);
          if (currentAbort) currentAbort.abort('ws-error');
          console.error('[relay] ws:error', { connectionId, callSid });
        },
        onClose() {
          if (currentAbort) currentAbort.abort('ws-closed');
          currentAbort = null;
          if (callSid) sessions.delete(callSid);
          console.log('[relay] close', { connectionId, callSid });
        },
      };
    });

  // Register both tutorial-style and previous route for flexibility
  app.get('/ws', makeRelayHandler());
  app.get('/twilio/relay', makeRelayHandler());
}
