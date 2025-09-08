import { Hono, type Context, type ErrorHandler } from 'hono';
import { cors } from 'hono/cors';
import { upgradeWebSocket, websocket } from 'hono/bun';
import dotenv from 'dotenv';

dotenv.config();

const app = new Hono();
const PORT = Number(process.env.PORT) || 3005;

// WebSocket helper for Bun <-> Hono (imported directly)

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

// Twilio Conversation Relay endpoints
import { registerTwilioRoutes } from './routes/twilio';
registerTwilioRoutes(app, upgradeWebSocket);

// Error handler (normalized shape)
const errorHandler: ErrorHandler = (err: Error, c: Context) => {
  console.error(err.stack);
  return c.json(
    {
      error: 'internal_error',
      message: err.message,
    },
    500
  );
};

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
