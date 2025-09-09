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

  // Use Amazon Polly with robotic voice settings
  // Using Matthew (male) or Joanna (female) in standard engine for more robotic sound
  // Alternative: Use neural engine with prosody tags for robotic effect
  
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<ConversationRelay url="${escapeXml(websocketUrl)}"` +
    ` ttsProvider="amazon-polly"` +
    ` voice="Matthew"` +
    ` engine="standard"` +
    ` language="en-US"` +
    `${greetingAttr}` +
    ` welcomeGreetingInterruptible="false"` +
    ` dtmfDetection="true"` +
    ` interruptible="true">` +
    `<TtsVoiceSettings>` +
    `<Prosody rate="85%" pitch="-10%" volume="loud">` +
    `<AmazonEffect name="drc" />` +
    `</Prosody>` +
    `</TtsVoiceSettings>` +
    `</ConversationRelay>` +
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
