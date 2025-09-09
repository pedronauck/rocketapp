import {
  streamText,
  experimental_createMCPClient as createMCPClient,
} from 'ai';
import { openai } from '@ai-sdk/openai';
import { getEnv } from '../config/env';
import { log } from '../utils/log';

const env = getEnv();
const DEFAULT_MODEL = env.AI_MODEL;

const DEFAULT_SYSTEM_PROMPT = `You are a friendly Pokédex Call Center agent.
Answer questions about Pokémon clearly and concisely (1-3 sentences).
Include types, strengths/weaknesses, evolutions or abilities when helpful.
This conversation is spoken aloud: NEVER format answers as Markdown or code; use plain text only.
Avoid emojis, bullet points, and special characters such as asterisks, underscores, code backticks, tildes, hashes, angle brackets, brackets, parentheses, slashes, or backslashes.
Spell out numbers in words (e.g., twenty, not 20). Do not mention that you are an AI.`;
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
      model: openai(DEFAULT_MODEL),
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
    model: openai(DEFAULT_MODEL),
    system: usePrompt ? SYSTEM_PROMPT : undefined,
    messages: usePrompt ? undefined : (toAiSdkMessages(msgs) as any),
    prompt: usePrompt?.prompt,
    abortSignal: opts?.abortSignal,
  });
  return result.textStream;
}
