// Tool: analyze_image
// Purpose: Given an image URL of a Pokémon, identify which Pokémon it is using a vision model.
// Implementation notes:
// - Uses OpenAI Chat Completions with vision-capable model (gpt-4o-mini) via HTTPS.
// - Requires OPENAI_API_KEY to be set in the environment.
// - Returns a structured JSON object: { pokemon, confidence, reasoning }

type AnalyzeImageInput = {
  image_url: string;
};

type AnalyzeImageOutput = {
  pokemon: string;
  confidence: number;
  reasoning: string;
};

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

function assertEnv() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || typeof key !== 'string' || key.trim() === '') {
    throw new Error(
      'Missing OPENAI_API_KEY in environment. Please set it to use the vision tool.'
    );
  }
  return key;
}

function validateInput(input: AnalyzeImageInput): string {
  if (!input || typeof input.image_url !== 'string') {
    throw new Error('Invalid input: expected { image_url: string }');
  }
  const url = input.image_url.trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('Invalid image_url: must be an http(s) URL');
  }
  return url;
}

export async function analyzeImageTool(
  input: AnalyzeImageInput
): Promise<AnalyzeImageOutput> {
  const apiKey = assertEnv();
  const imageUrl = validateInput(input);

  const system = [
    'You are a precise Pokémon recognition assistant.',
    'Given a single image, identify the most likely Pokémon name.',
    'If uncertain, return your best guess but lower confidence accordingly.',
    'Return JSON ONLY with fields: pokemon (string), confidence (0-1), reasoning (short string).',
  ].join(' ');

  const userText = [
    'Identify the Pokémon in the image.',
    'Return JSON with keys: pokemon, confidence, reasoning.',
  ].join(' ');

  const body = {
    model: DEFAULT_MODEL,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
  } as const;

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `OpenAI request failed (${res.status} ${res.statusText}): ${errText}`
    );
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data?.choices?.[0]?.message?.content ?? '';
  if (!content) {
    // Fallback conservative response
    return {
      pokemon: 'unknown',
      confidence: 0,
      reasoning: 'No content returned from the model.',
    };
  }

  try {
    const parsed = JSON.parse(content) as Partial<AnalyzeImageOutput>;
    const pokemon = String(parsed.pokemon ?? 'unknown');
    const confidenceRaw = Number(parsed.confidence ?? 0);
    const confidence = isFinite(confidenceRaw)
      ? Math.max(0, Math.min(1, confidenceRaw))
      : 0;
    const reasoning = String(parsed.reasoning ?? '');
    return { pokemon, confidence, reasoning };
  } catch (e) {
    console.error('Failed to parse model response:', e);
    // If model returned non-JSON by some reason, provide a conservative fallback.
    return {
      pokemon: 'unknown',
      confidence: 0,
      reasoning: 'Failed to parse JSON response from the model.',
    };
  }
}
