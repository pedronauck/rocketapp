import { z } from 'zod';
import { generateText } from 'ai';
import { getEnv } from '../config/env';
import { log } from '../utils/log';
import { selectTextModel } from './ai';

export type Channel = 'voice' | 'messaging';

const DecisionSchema = z.object({
  action: z
    .enum(['chat', 'wait_for_image', 'cancel_wait', 'ack_name_only'])
    .describe(
      'chat = stream a normal assistant answer; wait_for_image = ask user to text an image and keep line open; cancel_wait = stop waiting for an image; ack_name_only = say a short acknowledgement (e.g., of their name) and do not stream a long answer.'
    ),
  reply: z
    .string()
    .describe('Plain text phrase to speak/send next (no Markdown).'),
  extractedName: z
    .string()
    .nullable()
    .optional()
    .describe(
      'If the user told their name, extract it (letters only). Otherwise null.'
    ),
});

export type Decision = z.infer<typeof DecisionSchema>;

export async function decideForPrompt(input: {
  channel: Channel;
  text: string;
  waitingForImage: boolean;
  callerName?: string | null;
  isNewCaller?: boolean;
}): Promise<Decision> {
  const env = getEnv();
  // Prefer Groq Structured Outputs using JSON Schema to avoid tool-call fallback
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) {
    try {
      const decision = await groqStructuredDecision(
        input,
        env.AI_MODEL,
        apiKey
      );
      return decision;
    } catch (err) {
      log.warn(
        '[reasoner] decideForPrompt structured failed; falling back',
        err
      );
    }
  }

  // Fallback: ask the model for JSON and parse (no schema guarantee)
  try {
    const system =
      'Return a compact JSON with keys action, reply, extractedName (string or null). No extra text.';
    const prompt = JSON.stringify({
      channel: input.channel,
      waitingForImage: input.waitingForImage,
      callerName: input.callerName ?? null,
      isNewCaller: !!input.isNewCaller,
      text: input.text,
    });
    const res = await generateText({
      model: selectTextModel(env.AI_MODEL),
      system,
      prompt,
      temperature: 0.2,
      maxTokens: 220,
    });
    const raw = JSON.parse(res.text || '{}');
    const parsed = DecisionSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch (err) {
    log.warn('[reasoner] decideForPrompt fallback parse failed', err);
  }
  return { action: 'chat', reply: 'Alright.', extractedName: null };
}

const ImageDecisionSchema = z.object({
  reply: z
    .string()
    .describe(
      'A single, friendly sentence to speak with the recognition result, tailored for voice. No Markdown.'
    ),
});

export async function decideForImage(input: {
  analysis: string; // raw result from vision model
  waitingForImage: boolean;
  callerName?: string | null;
}): Promise<{ reply: string }> {
  const env = getEnv();
  const apiKey = process.env.GROQ_API_KEY;
  if (apiKey) {
    try {
      const reply = await groqStructuredImageReply(input, env.AI_MODEL, apiKey);
      return { reply };
    } catch (err) {
      log.warn(
        '[reasoner] decideForImage structured failed; falling back',
        err
      );
    }
  }
  // Fallback: simple single-sentence rewrite
  try {
    const system =
      'Rewrite the following into one friendly plain sentence for voice. No Markdown.';
    const prompt =
      (input.callerName ? `${input.callerName}, ` : '') + input.analysis;
    const res = await generateText({
      model: selectTextModel(env.AI_MODEL),
      system,
      prompt,
      temperature: 0.2,
      maxTokens: 120,
    });
    return { reply: res.text.trim() };
  } catch {}
  return { reply: input.analysis };
}

// ---------------------------
// Groq Structured helpers
// ---------------------------
async function groqStructuredDecision(
  input: {
    channel: Channel;
    text: string;
    waitingForImage: boolean;
    callerName?: string | null;
    isNewCaller?: boolean;
  },
  modelId: string,
  apiKey: string
): Promise<Decision> {
  const sys = [
    'You route a voice conversation about Pokémon.',
    'Pick the best immediate action and produce a brief, natural reply for speech.',
    'No Markdown. 1–2 short sentences. Output via JSON schema only.',
  ].join(' ');

  const user = {
    channel: input.channel,
    waitingForImage: input.waitingForImage,
    callerName: input.callerName ?? null,
    isNewCaller: !!input.isNewCaller,
    text: input.text,
  };

  const schema = {
    name: 'decision',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['chat', 'wait_for_image', 'cancel_wait', 'ack_name_only'],
          description:
            'chat=stream a normal answer; wait_for_image=ask for photo and hold; cancel_wait=stop holding; ack_name_only=acknowledge their name only',
        },
        reply: {
          type: 'string',
          description: 'One or two short sentences, plain text for speech.',
        },
        extractedName: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Caller first name if provided; otherwise null.',
        },
      },
      required: ['action', 'reply', 'extractedName'],
    },
  } as const;

  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(user) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { ...schema, strict: true },
    },
    temperature: 0.0,
    top_p: 0.1,
    max_tokens: 384,
  } as const;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    // Retry with JSON Object mode when schema generation fails, invalid schema, or token limit hit
    if (
      /json_validate_failed|Failed to generate JSON|max completion tokens|invalid schema/i.test(
        t
      )
    ) {
      const retry = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: sys + ' Respond with JSON only.' },
              { role: 'user', content: JSON.stringify(user) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.0,
            top_p: 0.1,
            max_tokens: 384,
          }),
        }
      );
      if (retry.ok) {
        const rj: any = await retry.json();
        const content = rj?.choices?.[0]?.message?.content || '{}';
        const parsed = DecisionSchema.safeParse(JSON.parse(content));
        if (parsed.success) return parsed.data;
      }
    }
    throw new Error(`groq structured decision failed: ${res.status} ${t}`);
  }
  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content || '{}';
  const parsed = DecisionSchema.parse(JSON.parse(content));
  return parsed;
}

async function groqStructuredImageReply(
  input: {
    analysis: string;
    waitingForImage: boolean;
    callerName?: string | null;
  },
  modelId: string,
  apiKey: string
): Promise<string> {
  const sys =
    'Return a single friendly plain sentence suitable for voice. No Markdown.';
  const user = {
    callerName: input.callerName ?? null,
    waitingForImage: input.waitingForImage,
    analysis: input.analysis,
  };
  const schema = {
    name: 'image_reply',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { reply: { type: 'string' } },
      required: ['reply'],
    },
  } as const;
  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: JSON.stringify(user) },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { ...schema, strict: true },
    },
    temperature: 0.0,
    top_p: 0.1,
    max_tokens: 256,
  } as const;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    // Retry with JSON object mode when schema generation fails, invalid schema, or token limit hit
    if (
      /json_validate_failed|Failed to generate JSON|max completion tokens|invalid schema/i.test(
        t
      )
    ) {
      const retry = await fetch(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelId,
            messages: [
              { role: 'system', content: sys + ' Respond with JSON only.' },
              { role: 'user', content: JSON.stringify(user) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.0,
            top_p: 0.1,
            max_tokens: 256,
          }),
        }
      );
      if (retry.ok) {
        const rj: any = await retry.json();
        const content = rj?.choices?.[0]?.message?.content || '{}';
        const parsed = ImageDecisionSchema.safeParse(JSON.parse(content));
        if (parsed.success) return parsed.data.reply;
      }
    }
    throw new Error(`groq structured image reply failed: ${res.status} ${t}`);
  }
  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content || '{}';
  const parsed = ImageDecisionSchema.parse(JSON.parse(content));
  return parsed.reply;
}
