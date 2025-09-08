import { createHmac, timingSafeEqual } from 'crypto';

export type SignatureValidationInput = {
  url: string; // full URL Twilio requested (including query string)
  method: string;
  headers: Headers;
  // Parsed form body for application/x-www-form-urlencoded only
  formParams?: Record<string, string | Blob | File | undefined> | undefined;
  authToken: string;
};

function buildBaseString(
  url: string,
  method: string,
  formParams?: Record<string, unknown>
) {
  // Twilio algorithm:
  // 1) Start with the full URL (including query string)
  // 2) If method is POST with application/x-www-form-urlencoded, append
  //    each POST parameter (sorted by name) as name + value (no separators)
  let base = url;
  if (method.toUpperCase() === 'POST' && formParams) {
    const entries: [string, unknown][] = Object.entries(formParams);
    const kv: [string, string][] = entries
      .filter(([_, v]) => typeof v === 'string')
      .map(([k, v]) => [k, String(v)]);
    kv.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [k, v] of kv) {
      base += k + v;
    }
  }
  return base;
}

export function validateTwilioSignature(
  input: SignatureValidationInput
): boolean {
  const signature = input.headers.get('X-Twilio-Signature');
  if (!signature) return false;

  const base = buildBaseString(input.url, input.method, input.formParams);
  const computed = createHmac('sha1', input.authToken)
    .update(base)
    .digest('base64');

  // timing safe compare
  try {
    const a = Buffer.from(signature);
    const b = Buffer.from(computed);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
