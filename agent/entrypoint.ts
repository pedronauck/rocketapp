// Compozy entrypoint file - exports all available tools for this example
// Load local .env for this example first, then fallback to process.cwd()
import dotenv from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { analyzeImageTool } from './pokemon_vision_tool.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Suppress dotenv logs so tool stdout remains strict JSON-only
dotenv.config({ path: resolve(__dirname, '.env'), quiet: true });
dotenv.config({ quiet: true });

export default {
  analyze_image: analyzeImageTool,
};
