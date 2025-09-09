type TwiMLOpts = {
  websocketUrl: string;
  welcomeGreeting?: string;
};

export function generateTwiML(opts: TwiMLOpts): string {
  const { websocketUrl, welcomeGreeting } = opts;
  
  // ElevenLabs voice configuration for Pokédex sound with robotic reverb
  // Format: VOICE_ID-flash_v2_5-speed_stability_similarity
  // 0.75 speed (slower for robotic effect), 0.95 stability (very monotone), 0.15 similarity (more robotic)
  // Note: Lower similarity and higher stability create more synthetic/robotic sound
  const voiceConfig = 'Daniel-flash_v2_5-0.75_0.95_0.15';
  
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
