type TwiMLOpts = {
  websocketUrl: string;
  welcomeGreeting?: string;
};

export function generateTwiML(opts: TwiMLOpts): string {
  const { websocketUrl, welcomeGreeting } = opts;

  // Build ConversationRelay attributes carefully
  let attributes = `url="${escapeXml(websocketUrl)}"`;

  // Add TTS configuration for Google with US male voice and higher pitch
  attributes += ` ttsProvider="Google"`;
  attributes += ` voice="en-US-Standard-B"`; // US male voice
  attributes += ` language="en-US"`;
  attributes += ` speechRate="1.2"`; // Slightly faster for robotic effect
  attributes += ` pitch="2.0"`; // Higher pitch for robotic sound

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
