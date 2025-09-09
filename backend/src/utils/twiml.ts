type TwiMLOpts = {
  websocketUrl: string;
  welcomeGreeting?: string;
};

export function generateTwiML(opts: TwiMLOpts): string {
  const { websocketUrl, welcomeGreeting } = opts;

  // Build ConversationRelay attributes carefully
  let attributes = `url="${escapeXml(websocketUrl)}"`;

  // Add TTS configuration for Google with robotic-sounding voice
  // Using Standard voice (more robotic than WaveNet) with adjusted pitch
  attributes += ` ttsProvider="Google"`;
  attributes += ` voice="en-GB-Standard-C"`; // Male voice with deeper tone
  attributes += ` language="en-GB"`;
  attributes += ` speechRate="1.2"`; // Slightly faster for robotic effect
  attributes += ` pitch="-2.0"`; // Lower pitch for more robotic sound

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
