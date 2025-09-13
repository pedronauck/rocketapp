import {
  streamText,
  experimental_createMCPClient as createMCPClient,
  generateText,
} from 'ai';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { getEnv } from '../config/env';
import { log } from '../utils/log';

const env = getEnv();
const DEFAULT_MODEL = env.AI_MODEL; // configured text model id (may be OpenAI-like)
const VISION_MODEL = env.AI_VISION_MODEL; // image recognition (OpenAI only)
// Note: provider setting is ignored for text; we always route to Groq via baseURL above.

// Groq via OpenAI-compatible endpoint (text only)
const groqViaOpenAI = createOpenAI({
  baseURL: 'https://api.groq.com/openai/v1',
  apiKey: process.env.GROQ_API_KEY,
});

// Route TEXT to Groq. Allow pass‑through for Groq models that support Structured Outputs.
const GROQ_FALLBACK_TEXT_MODEL = 'llama-3.1-8b-instant';
const GROQ_STRUCTURED_SUPPORTED = new Set(
  [
    'openai/gpt-oss-20b',
    'openai/gpt-oss-120b',
    'moonshotai/kimi-k2-instruct',
    'moonshotai/kimi-k2-instruct-0905',
    'meta-llama/llama-4-maverick-17b-128e-instruct',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ].map((s) => s.toLowerCase())
);
function mapToGroqModelId(modelId: string): string {
  const id = (modelId || '').trim();
  if (!id) return GROQ_FALLBACK_TEXT_MODEL;
  if (GROQ_STRUCTURED_SUPPORTED.has(id.toLowerCase())) return id; // pass through
  // For all others, use a fast fallback
  return GROQ_FALLBACK_TEXT_MODEL;
}

export function selectTextModel(modelId: string) {
  const groqId = mapToGroqModelId(modelId);
  return groqViaOpenAI(groqId);
}

// Always use OpenAI models directly. Groq is not supported for vision.
function selectOpenAIModel(modelId: string) {
  // Accept values like "openai/gpt-4o-mini" or just "gpt-4o-mini".
  const id = modelId.replace(/^openai\//i, '');
  return openai(id);
}

const DEFAULT_SYSTEM_PROMPT = `You are a friendly Pokédex Call Center agent having a casual conversation with a caller.

RESPONSE STYLE:
- Answer in a conversational, natural way like you're talking to a friend
- Keep responses to 1-3 sentences maximum
- NEVER use bullet points, numbered lists, or any list formatting
- NEVER use dashes, asterisks, or any markdown symbols
- NEVER structure information as lists or categories
- Just speak normally and conversationally

CONTENT GUIDELINES:
- Include types, strengths/weaknesses, evolutions or abilities when relevant
- Give direct, straightforward answers
- Make it feel like a natural phone conversation

FORBIDDEN FORMATTING:
- No bullet points (•, -, *)
- No numbered lists (1., 2., etc.)
- No markdown formatting (**bold**, *italic*, etc.)
- No special characters or symbols
- No structured lists or categories

EXAMPLES OF GOOD RESPONSES:
"Good to hear from you! Pikachu is an Electric-type Pokémon that's super popular and can evolve into Raichu."
"That Charizard is a powerful Fire and Flying type with incredible speed and special attack moves."

EXAMPLES OF BAD RESPONSES:
"- Pikachu: Electric type
- Evolves to: Raichu
- Strengths: Speed and Special Attack"

Always respond as if you're having a friendly phone chat. Keep it simple, direct, and conversational. Spell out numbers in words (e.g., twenty, not 20). Do not mention that you are an AI.`;
const SYSTEM_PROMPT = env.SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

// Streaming variant to reduce latency for spoken responses
export async function streamAnswer(
  question: string,
  opts?: { abortSignal?: AbortSignal }
): Promise<AsyncIterable<string>> {
  return createStream(undefined, question, opts);
}

export type SimpleMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

function toAiSdkMessages(msgs: SimpleMessage[]) {
  // AI SDK CoreMessage format expects `content` as a string for basic messages.
  // The previous implementation used UI message parts (array of segments),
  // which caused validation errors. Convert directly to string content.
  return msgs.map((m) => ({ role: m.role as any, content: m.content }));
}

export async function streamAnswerWithMessages(
  messages: SimpleMessage[],
  opts?: { abortSignal?: AbortSignal }
): Promise<AsyncIterable<string>> {
  const stream = await createStream(messages, undefined, opts);
  return stream;
}

async function createStream(
  messages: SimpleMessage[] | undefined,
  prompt: string | undefined,
  opts?: { abortSignal?: AbortSignal }
): Promise<AsyncIterable<string>> {
  const baseMessages = buildBaseMessages(messages, prompt);
  const usePrompt = wantsPrompt(baseMessages, prompt);
  // const mcpUrl = env.POKE_MCP_SSE_URL;
  // if (mcpUrl) {
  //   const stream = await streamWithMcp(baseMessages, usePrompt, opts);
  //   if (stream) return stream;
  // }
  return streamWithoutMcp(baseMessages, usePrompt, opts);
}

function buildBaseMessages(
  messages: SimpleMessage[] | undefined,
  prompt?: string
): SimpleMessage[] {
  if (messages && messages.length) return messages;
  if (prompt)
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];
  return [{ role: 'system', content: SYSTEM_PROMPT }];
}

function wantsPrompt(msgs: SimpleMessage[], prompt?: string) {
  const hasUser = msgs.some((m) => m.role === 'user');
  return !hasUser && !!prompt ? { prompt } : undefined;
}

export async function streamWithMcp(
  msgs: SimpleMessage[],
  usePrompt: { prompt: string } | undefined,
  opts?: { abortSignal?: AbortSignal }
) {
  const url = env.POKE_MCP_SSE_URL;
  if (!url) return null;
  const client = await createMCPClient({ transport: { type: 'sse', url } });
  try {
    const tools = await client.tools();
    const result = streamText({
      model: selectTextModel(DEFAULT_MODEL),
      system: usePrompt ? SYSTEM_PROMPT : undefined,
      messages: usePrompt ? undefined : (toAiSdkMessages(msgs) as any),
      prompt: usePrompt?.prompt,
      tools,
      abortSignal: opts?.abortSignal,
      onFinish: async () => {
        await client.close();
      },
      onError: async (e) => {
        log.warn('[ai] stream error with MCP:', (e as any)?.message || e);
        await client.close();
      },
    });
    return result.textStream;
  } catch (e) {
    log.warn('[ai] MCP unavailable, falling back:', (e as any)?.message || e);
    try {
      await client.close();
    } catch {}
    return null;
  }
}

function streamWithoutMcp(
  msgs: SimpleMessage[],
  usePrompt: { prompt: string } | undefined,
  opts?: { abortSignal?: AbortSignal }
) {
  const result = streamText({
    model: selectTextModel(DEFAULT_MODEL),
    system: usePrompt ? SYSTEM_PROMPT : undefined,
    messages: usePrompt ? undefined : (toAiSdkMessages(msgs) as any),
    prompt: usePrompt?.prompt,
    abortSignal: opts?.abortSignal,
  });
  return result.textStream;
}

// ----------------------------------------------------------------------------
// Vision: Identify Pokémon from an image using OpenAI (AI SDK)
// ----------------------------------------------------------------------------

export async function identifyPokemonFromImageUrl(
  imageUrl: string
): Promise<string> {
  const model = selectOpenAIModel(VISION_MODEL);

  // Try to fetch the image locally and pass raw bytes to the model to avoid
  // any cross-origin or authentication issues with provider-side fetching.
  const { data, mimeType } = await fetchImageBytes(imageUrl);

  // Short, plain-text only answer optimized for voice readout.
  const system =
    'You are a Pokédex vision assistant identifying Pokémon from photos for a phone call. ' +
    'Respond in a conversational way like you are talking on the phone. ' +
    'Reply with 1-2 plain sentences, no Markdown, no bullets, no emojis. ' +
    'CRITICAL WARNING: Never ever use asterisks (*), bullet points (-), or any list formatting. ' +
    'FORBIDDEN: Do not use *, /, \\, $, @, %, &, +, =, |, ^, or any symbols. ' +
    'FORBIDDEN: No bullet points, numbered lists, or structured formatting. ' +
    'Include a confidence percentage in parentheses like (conf eighty three percent). ' +
    'If unsure, state the top guess and say you are not fully certain. ' +
    'Use only plain text with letters, spaces, commas, periods, question marks, and exclamation points. ' +
    'Make it sound like a natural phone conversation.';

  const res = await generateText({
    model,
    system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What Pokémon is in this photo? Identify it and give a brief description.',
          },
          {
            type: 'image',
            image: data,
            mimeType,
          },
        ],
      },
    ] as any,
    temperature: 0.2,
    maxTokens: 200,
  });

  // Post-process response to remove any special characters that might slip through
  let cleanedText = res.text.trim();
  cleanedText = cleanedText.replace(/[*\/\\$@%&+=|^<>[\]{}~#]/g, ''); // Remove special chars
  cleanedText = cleanedText.replace(/\s+/g, ' '); // Normalize spaces
  cleanedText = cleanedText.trim();

  return cleanedText;
}

async function fetchImageBytes(
  url: string
): Promise<{ data: Buffer; mimeType?: string }> {
  const u = new URL(url);

  const headers: Record<string, string> = {};
  // If the image is hosted by Twilio and requires auth, attach basic auth using env.
  if (/\.twilio\.com$/i.test(u.hostname) || /twilio/i.test(u.hostname)) {
    const sid = env.TWILIO_ACCOUNT_SID;
    const token = env.TWILIO_AUTH_TOKEN;
    if (sid && token) {
      const creds = Buffer.from(`${sid}:${token}`).toString('base64');
      headers['Authorization'] = `Basic ${creds}`;
    }
  }

  let res = await fetch(url, { headers });
  // Retry once without headers or with headers depending on first attempt
  if (!res.ok && !headers['Authorization']) {
    res = await fetch(url);
  } else if (!res.ok && headers['Authorization']) {
    res = await fetch(url);
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`);
  }

  const ct = res.headers.get('content-type') || undefined;
  const ab = await res.arrayBuffer();
  return { data: Buffer.from(ab), mimeType: ct };
}
