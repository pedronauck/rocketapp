# Pokedex Call Center (Twilio ConversationRelay)

This backend exposes a simple AI-powered Pokedex Call Center using Twilio ConversationRelay over WebSocket and the Vercel AI SDK for LLM calls.

Key endpoints:

- `POST /twiml` – returns TwiML that connects the call to your ConversationRelay WebSocket (tutorial-style). `GET /twiml` is also supported for local/browser debugging.
- `GET  /ws` – WebSocket endpoint Twilio connects to for the live conversation.
- (compat) `POST /twilio/voice` and `GET /twilio/relay` remain available.
- `POST /twilio/messaging` – Twilio Messaging webhook (SMS/WhatsApp). Accepts image URLs or base64 images and uses OpenAI Vision (via AI SDK) to recognize the Pokémon. It then speaks the result on the active call.
- Async follow-up: The webhook now replies immediately with an acknowledgment and processes the image in the background. When done, it sends a follow-up SMS/WhatsApp via Twilio REST.
- `GET  /img/:file` – Serves locally uploaded images (used when inbound message includes base64 data). Example: `http://localhost:3005/img/abc123.png`.
- `GET  /api/ask/stream?q=...` – Server‑Sent Events endpoint for browser/chat clients. Emits `thinking`, multiple `token` events, then `done`.

Environment variables (see `backend/.env`):

- `PROVIDER` – `groq` (default) or `openai` for TEXT answers. Image recognition always uses OpenAI.
- `OPENAI_API_KEY` – required for text when `PROVIDER=openai`, and always required for vision.
- `GROQ_API_KEY` – required when `PROVIDER=groq`.
- `AI_MODEL` – text model id (default `openai/gpt-oss-20b`).
- `AI_VISION_MODEL` – vision model id for OpenAI (default `openai/gpt-4o-mini`).
- `AI_TIMEOUT_MS` – optional, default `20000`; aborts slow generations/streams.
- `NGROK_URL` – your ngrok domain without scheme (e.g., `abcd1234.ngrok-free.app`).
- `RELAY_WELCOME_GREETING` – optional greeting spoken at call start.
- `RELAY_THINKING_ENABLED` – optional, default `true`. When enabled, the backend sends a random friendly placeholder message immediately so callers hear something while the model is thinking. The system includes 30+ different friendly messages that are randomly selected for variety.
- `POKE_MCP_SSE_URL` – optional MCP SSE endpoint (from poke-mcp) to enable tool-calling for Pokémon facts.
- `TWILIO_AUTH_TOKEN` – optional; if set, `/twilio/voice` validates `X-Twilio-Signature`.
- `TWILIO_ACCOUNT_SID` – required for outbound async follow-ups.
- `TWILIO_FROM_NUMBER` – Twilio number to send from (e.g., `+15551234567` or `whatsapp:+15551234567`). Use if not using a Messaging Service.
- `TWILIO_MESSAGING_SERVICE_SID` – optional; if set, used for outbound sends instead of `From`.

Twilio setup:

1. Configure your incoming Voice webhook (in Twilio Console) to `POST` `https://<your-ngrok>/twiml`.
2. The returned TwiML instructs Twilio to connect the call to `wss://<your-ngrok>/ws`.
3. ConversationRelay sends transcribed prompts to the WS. The backend streams back `{ type: "text", token, last: false }` chunks and finally `{ last: true }`.

Security:

- If `TWILIO_AUTH_TOKEN` is set, `/twilio/voice` validates Twilio signatures and returns 401 on mismatch.
- CORS is applied only to `/health` to avoid interfering with WebSocket upgrades on `/twilio/relay`.

Run locally:

```bash
bun install
bun run dev
# use ngrok section below to expose publicly
```

Using Groq for text (default) + OpenAI for vision:

```bash
export PROVIDER=groq
export GROQ_API_KEY=gsk-********************************
# optional overrides
export AI_MODEL=openai/gpt-oss-20b
export OPENAI_API_KEY=sk-********************************   # required for vision
export AI_VISION_MODEL=openai/gpt-4o-mini

cd backend
bun run dev
```

Using poke-mcp (MCP Tools):

```bash
# 1) Run the Poke MCP server (SSE) separately
git clone https://github.com/naveenbandarage/poke-mcp.git
cd poke-mcp && npm i && npm run build
npm start  # defaults to http://localhost:3000/sse

# 2) Point backend to MCP SSE endpoint
export POKE_MCP_SSE_URL=http://localhost:3000/sse

# 3) Start backend
cd ../twilio-test/backend
bun run dev
```

Using OpenAI for text (optional; vision still OpenAI):

```bash
export PROVIDER=openai
export OPENAI_API_KEY=sk-********************************
# text model choice for OpenAI provider
export AI_MODEL=gpt-4o-mini
# vision
export AI_VISION_MODEL=openai/gpt-4o-mini

cd backend
bun run dev
```

When configured, the AI can optionally call MCP tools for authoritative Pokémon data instead of guessing.

## Expose locally with ngrok (ConversationRelay)

Follow the Twilio tutorial flow with ngrok to test calls to your local backend:

1. Install and start the backend

```bash
cd backend
bun install
bun run dev   # starts on http://localhost:3005
```

2. Start ngrok on the same port and set NGROK_URL

```bash
ngrok http 3005
# Copy the https URL it prints, e.g. https://abcd1234.ngrok-free.app
export NGROK_URL=abcd1234.ngrok-free.app   # no scheme
```

3. Configure your Twilio Phone Number (Console → Phone Numbers → Manage → Active Numbers)

- A Call Comes In → Webhook (POST) → `https://<your-ngrok>/twiml`
- Save

4. (Optional, recommended) Enable request validation

- Set `TWILIO_AUTH_TOKEN` in `backend/.env` (same value from Twilio Console)
- Our validator reconstructs the external URL using `Host` and `X-Forwarded-Proto` headers, so it works behind ngrok

5. Call your Twilio number

- The `/twiml` endpoint returns TwiML that connects the call to
  `wss://<your-ngrok>/ws`
- The ConversationRelay channel streams your speech as `prompt` messages
- The backend streams back `{ type: "text", token, last: false }` chunks and finally `{ last: true }`

Troubleshooting:

- If you see WS upgrade errors, ensure CORS is not applied on `/twilio/relay` (it isn’t by default here)
- If signature validation fails locally, temporarily unset `TWILIO_AUTH_TOKEN` to bypass while debugging
- Ensure your ngrok URL is https (Twilio requires TLS); `wss://` is derived automatically from `https` in our TwiML

## Messaging (WhatsApp)

1. Point your Twilio Messaging webhook to `POST https://<your-ngrok>/twilio/messaging`.
2. While on a call, say “check my Pokémon photo”. The assistant will say “Okay, I’ll wait your photo” and keep the line open.
3. Send an image over WhatsApp, an image URL, or a base64 data URL.
   - If Twilio includes `MediaUrl0` for an image, the backend fetches the media (using Basic Auth if `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are set) and sends the bytes to OpenAI Vision.
   - If the message `Body` contains a base64 image (e.g., `data:image/png;base64,...`), the backend decodes it and sends the bytes to OpenAI Vision.
4. The webhook returns an empty TwiML `<Response/>` so Twilio does NOT send a WhatsApp message back. The backend analyzes the image and speaks the result on the ongoing call.

WhatsApp setup notes:

- Use a WhatsApp-enabled sender. For Twilio Sandbox testing, use `whatsapp:+14155238886` as your `From` value. For production, use your approved WhatsApp-enabled number or a Messaging Service configured with a WhatsApp Sender.
- Ensure the `To` and `From` numbers are prefixed with `whatsapp:` (e.g., `whatsapp:+15551234567`).
- You can set `TWILIO_FORCE_WHATSAPP=true` to coerce the `whatsapp:` prefix for both `To` and `From` when sending outbound messages.
- Twilio only allows template (pre-approved) messages outside the 24‑hour customer care window; within the window, free‑form session messages are allowed.

Notes:

- The backend fetches images server‑side and sends the bytes to OpenAI Vision; Twilio media URLs that require authentication are supported if `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are configured.
- Keep the webhook response under ~15 seconds to avoid Twilio timeouts. This backend processes the image asynchronously and immediately responds with an empty TwiML, then speaks the result on the call.
- If there is no active call for the sender, the webhook still returns `<Response/>` and no WhatsApp message is sent.
