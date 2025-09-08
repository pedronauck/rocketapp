# Pokedex Call Center (Twilio ConversationRelay)

This backend exposes a simple AI-powered Pokedex Call Center using Twilio ConversationRelay over WebSocket and the Vercel AI SDK for LLM calls.

Key endpoints:

- `GET  /twiml` – returns TwiML that connects the call to your ConversationRelay WebSocket (tutorial-style).
- `GET  /ws` – WebSocket endpoint Twilio connects to for the live conversation.
- (compat) `POST /twilio/voice` and `GET /twilio/relay` remain available.

Environment variables (see `backend/.env`):

- `OPENAI_API_KEY` – API key for OpenAI models.
- `AI_MODEL` – optional, defaults to `gpt-4o-mini`.
- `AI_TIMEOUT_MS` – optional, default `20000`; aborts slow generations/streams.
- `NGROK_URL` – your ngrok domain without scheme (e.g., `abcd1234.ngrok-free.app`).
- `RELAY_WELCOME_GREETING` – optional greeting spoken at call start.
- `POKE_MCP_SSE_URL` – optional MCP SSE endpoint (from poke-mcp) to enable tool-calling for Pokémon facts.
- `TWILIO_AUTH_TOKEN` – optional; if set, `/twilio/voice` validates `X-Twilio-Signature`.

Twilio setup:

1. Configure your incoming Voice webhook (in Twilio Console) to `GET` `https://<your-ngrok>/twiml`.
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

Using OpenAI with AI SDK:

```bash
export OPENAI_API_KEY=sk-********************************
# optional
export AI_MODEL=gpt-4o-mini

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

When configured, the AI will call MCP tools for authoritative Pokémon data instead of guessing.

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

- A Call Comes In → Webhook (GET) → `https://<your-ngrok>/twiml`
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
