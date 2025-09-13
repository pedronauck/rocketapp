/**
 * Friendly thinking messages for Pokemon queries
 * These are sent immediately to provide user feedback while AI processes the response
 */

const THINKING_MESSAGES = [
  'Got it! Let me think about that Pokémon for you...',
  "Hmm, that's a great question! Gathering my thoughts...",
  'One moment while I recall everything about that Pokémon!',
  'Excellent choice! Let me dig into the details...',
  'I love talking about Pokémon! Just a second...',
  "That's an interesting one! Let me think through this...",
  "Good question! I'm processing all the info I have...",
  'Pokémon knowledge incoming! Just a moment...',
  'Let me search my extensive Pokédex for that one...',
  "That's a fun Pokémon to discuss! Thinking...",
  'I know just the thing! Give me a second to organize...',
  'Pokémon expert mode activated! Processing...',
  "That's one of my favorites! Let me recall the details...",
  "Great question! I'm compiling all the information...",
  'Pokémon trivia time! Just a moment...',
  'I have so much to tell you about that one! Thinking...',
  "That's an excellent choice for discussion! One sec...",
  'My Pokédex is whirring! Almost ready...',
  'Pokémon facts loading... Just a moment!',
  'I know all about that Pokémon! Processing...',
  "That's a fascinating Pokémon! Let me gather my thoughts...",
  'Pokémon knowledge base activated! Thinking...',
  'I have the perfect answer for you! Just a second...',
  "That's one I know well! Processing the details...",
  'Pokémon enthusiast mode: ON! Thinking...',
  'I love questions like this! Let me think...',
  'Pokémon wisdom incoming! Just a moment...',
  "That's a great Pokémon choice! Processing...",
  'My Pokédex has everything about that one! Thinking...',
  "Perfect question! I'm compiling the answer...",
] as const;

/**
 * Get a random thinking message from the pool
 * @returns A random friendly thinking message
 */
export function getRandomThinkingMessage(): string {
  const randomIndex = Math.floor(Math.random() * THINKING_MESSAGES.length);
  return THINKING_MESSAGES[randomIndex];
}

/**
 * Image processing messages - sent when analyzing Pokémon photos
 */
const IMAGE_PROCESSING_MESSAGES = [
  'I received your photo! Let me analyze this Pokémon for you...',
  'Got your Pokémon photo! Give me a moment to identify it...',
  'Photo received! My Pokédex scanner is working on it...',
  'I see your Pokémon photo! Just analyzing it now...',
  'Thanks for the photo! Let me research this Pokémon...',
  'Photo captured! Scanning the Pokédex database...',
  'I got your image! Let me identify this Pokémon...',
  'Photo received! My vision system is processing it...',
  'Thanks for sending the photo! Analyzing now...',
  'I see the Pokémon photo! Let me examine it carefully...',
  'Photo received! My Pokédex is identifying it...',
  'Got it! Let me scan this Pokémon with my database...',
  'Thanks for the image! Processing the Pokémon identification...',
  'Photo received! Let me research this one in my Pokédex...',
  'I got your Pokémon photo! Analyzing it now...',
] as const;

/**
 * Get a random image processing message
 * @returns A random friendly image processing message
 */
export function getRandomImageProcessingMessage(): string {
  const randomIndex = Math.floor(
    Math.random() * IMAGE_PROCESSING_MESSAGES.length
  );
  return IMAGE_PROCESSING_MESSAGES[randomIndex];
}

/**
 * Get the total number of available image processing messages
 * @returns The count of image processing messages
 */
export function getImageProcessingMessagesCount(): number {
  return IMAGE_PROCESSING_MESSAGES.length;
}

/**
 * Get the total number of available thinking messages
 * @returns The count of thinking messages
 */
export function getThinkingMessagesCount(): number {
  return THINKING_MESSAGES.length;
}
