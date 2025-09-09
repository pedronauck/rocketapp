# Pokémon Vision Example

This example demonstrates a two-step image workflow:

1) Recognize which Pokémon appears in an input image using a vision tool.
2) Pass the recognized name to a Pokédex agent that returns basic info (types, abilities, summary, etc.).

It uses a TypeScript tool that calls a vision-capable model (OpenAI `gpt-4o-mini`) and an agent action for Pokédex information, orchestrated by Compozy with structured JSON outputs.

## What it shows

- Image input via workflow schema (`image_url`)
- Vision model integration using an external tool (Bun runtime)
- Second-stage agent that provides Pokédex basics from recognized name
- Agent/tool orchestration with JSON-mode output

## Requirements

- Set `OPENAI_API_KEY` in your environment. This example loads env in this order:
  1) `examples/pokemon-img/.env`
  2) Process CWD `.env` (repo root)
- Network access enabled (the example runtime includes `--allow-net`).

## Running

```bash
cd examples/pokemon-img
../../compozy dev
```

Then trigger the workflow via API (see `api.http`). The final output now includes both recognition fields and a `pokedex` object with basic information.

## Notes

- The example configures `openai:gpt-4o-mini` as the default model in `compozy.yaml`. The actual image analysis happens in the `analyze_image` tool using the same OpenAI API.
- Input is an image URL (`image_url`). The image must be publicly accessible over http/https (no auth).
