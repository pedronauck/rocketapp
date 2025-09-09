interface GreetingInput {
  name: string;
  style?: string;
}

interface GreetingOutput {
  message: string;
  timestamp: string;
}

export async function greetingTool(input: GreetingInput): Promise<GreetingOutput> {
  const { name, style = "friendly" } = input;
  const styles = {
    friendly: `Hello there, ${name}! Hope you're having a great day!`,
    formal: `Good day, ${name}. It's a pleasure to meet you.`,
    casual: `Hey ${name}! What's up?`,
    enthusiastic: `${name}! So excited to meet you! 🎉`
  };

  const message = styles[style as keyof typeof styles] || styles.friendly;
  return {
    message,
    timestamp: new Date().toISOString()
  };
}
