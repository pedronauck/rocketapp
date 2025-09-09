import { Hono, type Context, type ErrorHandler } from 'hono';
import { cors } from 'hono/cors';
import { upgradeWebSocket, websocket } from 'hono/bun';
import dotenv from 'dotenv';
import { getEnv } from './config/env';
import { log } from './utils/log';
import { registerTwilioRoutes } from './routes/twilio';
import { initDatabase } from './db/database';

const app = new Hono();
dotenv.config();
const env = getEnv();
const PORT = env.PORT;

// Initialize database
try {
  initDatabase(env.DATABASE_PATH);
  log.info('[main] Database initialized');
} catch (error) {
  log.error('[main] Failed to initialize database', error);
  // Continue running even if database fails - fallback to in-memory only
}

// CORS middleware applied only where needed (avoid WS upgrade conflicts)
app.use(
  '/health',
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
  })
);

app.get('/health', (c: Context) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Error handler (normalized shape)
const errorHandler: ErrorHandler = (err: Error, c: Context) => {
  log.error(err.stack);
  return c.json(
    {
      error: 'internal_error',
      message: err.message,
    },
    500
  );
};

registerTwilioRoutes(app, upgradeWebSocket);

app.onError(errorHandler);

app.notFound((c) =>
  c.json({ error: 'not_found', message: 'Route not found' }, 404)
);

// Export fetch/websocket/port for Bun's HMR-managed server
export default {
  fetch: app.fetch,
  websocket,
  port: PORT,
};
