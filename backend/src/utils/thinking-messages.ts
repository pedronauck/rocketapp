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
 * Get the total number of available thinking messages
 * @returns The count of thinking messages
 */
export function getThinkingMessagesCount(): number {
  return THINKING_MESSAGES.length;
}
