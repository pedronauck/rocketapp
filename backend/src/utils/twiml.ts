type TwiMLOpts = {
  websocketUrl: string;
  welcomeGreeting?: string;
};

export function generateTwiML(opts: TwiMLOpts): string {
  const { websocketUrl, welcomeGreeting } = opts;
  // Minimal TwiML that connects the call to ConversationRelay over WebSocket
  // https://www.twilio.com/docs/voice/conversationrelay
  const greetingAttr = welcomeGreeting
    ? ` welcomeGreeting="${escapeXml(welcomeGreeting)}"`
    : '';

  // Use ElevenLabs with Pokédex robotic voice settings
  // Format: VOICE_ID-model-speed_stability_similarity
  // Speed: 0.8 (slower), Stability: 0.9 (monotone), Similarity: 0.2 (robotic)
  const voiceConfig = 'UgBBYS2sOqTuMpoF3BR0-flash_v2_5-0.8_0.9_0.2';

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<ConversationRelay url="${escapeXml(websocketUrl)}"` +
    ` ttsProvider="ElevenLabs"` +
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
