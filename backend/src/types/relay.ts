import { z } from 'zod';

export const SetupMessage = z.object({
  type: z.literal('setup'),
  callSid: z.string().optional(),
});

export const PromptMessage = z.object({
  type: z.literal('prompt'),
  // Twilio examples may use different fields; accept either.
  voicePrompt: z.string().optional(),
  text: z.string().optional(),
}).refine((v) => Boolean(v.voicePrompt || v.text), {
  message: 'prompt requires voicePrompt or text',
});

export const InterruptMessage = z.object({
  type: z.literal('interrupt'),
});

export const PingMessage = z.object({
  type: z.literal('ping'),
});

export const KnownMessage = z.discriminatedUnion('type', [
  SetupMessage,
  PromptMessage,
  InterruptMessage,
  PingMessage,
]);

export type SetupMessageT = z.infer<typeof SetupMessage>;
export type PromptMessageT = z.infer<typeof PromptMessage>;
export type InterruptMessageT = z.infer<typeof InterruptMessage>;
export type PingMessageT = z.infer<typeof PingMessage>;
export type KnownMessageT = z.infer<typeof KnownMessage>;

export type UnknownMessageT = { type: string } & Record<string, unknown>;

export function parseKnownMessage(raw: unknown): KnownMessageT | null {
  const parsed = KnownMessage.safeParse(raw);
  if (parsed.success) return parsed.data;
  return null;
}

