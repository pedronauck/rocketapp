import type { Hono } from 'hono';
import type { Context } from 'hono';
import { getEnv } from '../config/env';
import { streamAnswer } from '../services/ai';
import { log } from '../utils/log';

export function registerStreamRoutes(app: Hono) {
  app.get('/api/ask/stream', async (c) => handleSSE(c));
}

async function handleSSE(c: Context) {
  const q = c.req.query('q') || '';
  if (!q) return c.json({ error: 'bad_request', message: 'Missing q' }, 400);
  const env = getEnv();
  const thinking = env.RELAY_THINKING_ENABLED ? (env.RELAY_THINKING_TEXT || '').trim() : '';

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: string) => {
        controller.enqueue(enc.encode(`event: ${event}\n`));
        controller.enqueue(enc.encode(`data: ${data}\n\n`));
      };

      try {
        // Immediate perceived feedback
        if (thinking) send('thinking', thinking);

        // For this simple endpoint, we don't persist history. If needed, extend with session.
        const tokenStream = await streamAnswer(q);
        for await (const token of tokenStream) {
          send('token', token);
        }
        send('done', '');
      } catch (e) {
        const msg = (e as any)?.message || String(e);
        log.error('[sse] error', { error: msg });
        send('error', msg);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
