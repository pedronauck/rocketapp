type TwiMLOpts = {
  websocketUrl: string;
  welcomeGreeting?: string;
};

export function generateTwiML(opts: TwiMLOpts): string {
  const { websocketUrl, welcomeGreeting } = opts;
  
  // Build ConversationRelay attributes carefully
  let attributes = `url="${escapeXml(websocketUrl)}"`;
  
  // Add TTS configuration for Google with UK voice
  attributes += ` ttsProvider="Google"`;
  attributes += ` voice="en-GB-Standard-B"`;
  attributes += ` language="en-GB"`;
  
  // Add welcome greeting if provided
  if (welcomeGreeting) {
    attributes += ` welcomeGreeting="${escapeXml(welcomeGreeting)}"`;
    attributes += ` welcomeGreetingInterruptible="false"`;
  }
  
  // Add interaction settings
  attributes += ` dtmfDetection="true"`;
  attributes += ` interruptible="true"`;
  
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response>` +
    `<Connect>` +
    `<ConversationRelay ${attributes}/>` +
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
