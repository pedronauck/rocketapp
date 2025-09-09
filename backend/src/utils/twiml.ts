type TwiMLOpts = {
  websocketUrl: string;
  welcomeGreeting?: string;
};

export function generateTwiML(opts: TwiMLOpts): string {
  const { websocketUrl, welcomeGreeting } = opts;
  
  // ElevenLabs voice configuration for Pokédex sound
  // Format: VOICE_ID-flash_v2_5-speed_stability_similarity
  // 0.8 speed (slightly slower), 0.9 stability (monotone), 0.2 similarity (robotic)
  const voiceConfig = 'Daniel-flash_v2_5-0.8_0.9_0.2';
  
  // Minimal TwiML that connects the call to ConversationRelay over WebSocket
  // https://www.twilio.com/docs/voice/conversationrelay
  const greetingAttr = welcomeGreeting
    ? ` welcomeGreeting="${escapeXml(welcomeGreeting)}"`
    : ' welcomeGreeting="Pokédex system online. State the Pokémon name for analysis."';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<ConversationRelay url="${escapeXml(websocketUrl)}"` +
    ` ttsProvider="elevenlabs"` +
    ` voice="${voiceConfig}"` +
    `${greetingAttr}` +
    ` welcomeGreetingInterruptible="false"` +
    ` dtmfDetection="true"` +
    ` interruptible="true"/>` +
    `</Connect>` +
    `</Response>`
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
