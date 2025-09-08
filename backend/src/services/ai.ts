import {
  generateText,
  streamText,
  experimental_createMCPClient as createMCPClient,
} from 'ai';
import { openai } from '@ai-sdk/openai';

const DEFAULT_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';

const SYSTEM_PROMPT = `You are a friendly Pokédex Call Center agent.
Answer questions about Pokémon clearly and concisely (1-3 sentences).
Include types, strengths/weaknesses, evolutions or abilities when helpful.
This conversation is spoken aloud: NEVER format answers as Markdown or code; use plain text only.
Avoid emojis, bullet points, and special characters such as asterisks, underscores, code backticks, tildes, hashes, angle brackets, brackets, parentheses, slashes, or backslashes.
Spell out numbers in words (e.g., twenty, not 20). Do not mention that you are an AI.`;

export async function getAnswer(question: string): Promise<string> {
  const mcpUrl = process.env.POKE_MCP_SSE_URL;

  // If poke-mcp is available via SSE, fetch tools dynamically and allow tool-calling
  if (mcpUrl) {
    const mcpClient = await createMCPClient({
      transport: { type: 'sse', url: mcpUrl },
    });
    try {
      const tools = await mcpClient.tools();
      const { text } = await generateText({
        model: openai(DEFAULT_MODEL),
        system:
          SYSTEM_PROMPT +
          '\nWhen you need factual Pokémon data (types, evolutions, abilities, stats), use the available tools instead of guessing.',
        prompt: question,
        tools,
      });
      return text.trim();
    } finally {
      await mcpClient.close();
    }
  }

  // Fallback (no MCP server configured)
  const { text } = await generateText({
    model: openai(DEFAULT_MODEL),
    system: SYSTEM_PROMPT,
    prompt: question,
  });
  return text.trim();
}

// Streaming variant to reduce latency for spoken responses
export async function streamAnswer(
  question: string,
  opts?: { abortSignal?: AbortSignal }
): Promise<AsyncIterable<string>> {
  const mcpUrl = process.env.POKE_MCP_SSE_URL;

  if (mcpUrl) {
    const mcpClient = await createMCPClient({
      transport: { type: 'sse', url: mcpUrl },
    });
    const tools = await mcpClient.tools();
    const result = streamText({
      model: openai(DEFAULT_MODEL),
      system:
        SYSTEM_PROMPT +
        '\nWhen you need factual Pokémon data (types, evolutions, abilities, stats), use the available tools instead of guessing.',
      prompt: question,
      tools,
      abortSignal: opts?.abortSignal,
      onFinish: async () => {
        await mcpClient.close();
      },
      onError: async () => {
        await mcpClient.close();
      },
    });
    return result.textStream;
  }

  // Fallback without MCP
  const result = streamText({
    model: openai(DEFAULT_MODEL),
    system: SYSTEM_PROMPT,
    prompt: question,
    abortSignal: opts?.abortSignal,
  });
  return result.textStream;
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
  const mcpUrl = process.env.POKE_MCP_SSE_URL;
  const baseMessages: SimpleMessage[] = messages.length
    ? messages
    : ([{ role: 'system', content: SYSTEM_PROMPT }] as SimpleMessage[]);

  if (mcpUrl) {
    const mcpClient = await createMCPClient({ transport: { type: 'sse', url: mcpUrl } });
    const tools = await mcpClient.tools();
    const result = streamText({
      model: openai(DEFAULT_MODEL),
      messages: toAiSdkMessages(baseMessages) as any,
      tools,
      abortSignal: opts?.abortSignal,
      onFinish: async () => { await mcpClient.close(); },
      onError: async () => { await mcpClient.close(); },
    });
    return result.textStream;
  }

  const result = streamText({
    model: openai(DEFAULT_MODEL),
    messages: toAiSdkMessages(baseMessages) as any,
    abortSignal: opts?.abortSignal,
  });
  return result.textStream;
}
