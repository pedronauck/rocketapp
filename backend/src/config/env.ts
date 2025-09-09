import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3005),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // AI / Models
  // Default model per requirements
  AI_MODEL: z.string().min(1).default('openai/gpt-oss-20b'),
  // Choose which provider to use for AI SDK models
  PROVIDER: z
    .union([z.literal('openai'), z.literal('groq')])
    .optional()
    .default('openai'),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),

  // External services
  POKE_MCP_SSE_URL: z.string().url().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // Twilio / Relay
  NGROK_URL: z.string().optional(),
  RELAY_WS_URL: z.string().optional(),
  RELAY_WELCOME_GREETING: z
    .string()
    .optional()
    .default(
      'Hi! Welcome to the Pokédex Call Center. Ask me about any Pokémon!'
    ),
  // Quick placeholder speech while the model thinks
  RELAY_THINKING_ENABLED: z
    .union([z.string(), z.boolean()])
    .transform((v) => (typeof v === 'string' ? v.toLowerCase() !== 'false' : v))
    .optional()
    .default(true),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  
  // JWT Secret for session tokens
  JWT_SECRET: z.string().min(32).default('your-secret-key-change-in-production'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Prompt
  SYSTEM_PROMPT: z.string().optional(),

  // Database
  DATABASE_PATH: z.string().default('./data/calls.db'),
});

type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // In dev, log validation errors clearly
    console.error('[env] Invalid configuration:', parsed.error.flatten());
    throw new Error('Invalid environment configuration');
  }
  cached = parsed.data;
  return cached;
}
