const messageTypes = ["greeting", "farewell", "thank-you"] as const;
const tones = ["formal", "casual", "playful"] as const;

export const tools = {
  "create-message": {
    name: "create-message",
    description: "Generate a custom message with various options",
    inputSchema: {
      type: "object" as const,
      properties: {
        messageType: {
          type: "string" as const,
          enum: messageTypes,
          description: "Type of message to generate",
        },
        recipient: {
          type: "string" as const,
          description: "Name of the person to address",
        },
        tone: {
          type: "string" as const,
          enum: tones,
          description: "Tone of the message",
        },
      },
      required: ["messageType", "recipient"],
    },
  },
};

export type CreateMessageArgs = {
  messageType: (typeof messageTypes)[number];
  recipient: string;
  tone?: (typeof tones)[number];
};

const messageFns = {
  greeting: {
    formal: (recipient: string) =>
      `Dear ${recipient}, I hope this message finds you well`,
    playful: (recipient: string) =>
      `Hey hey ${recipient}! What's shakin'?`,
    casual: (recipient: string) => `Hi ${recipient}! How are you?`,
  },
  farewell: {
    formal: (recipient: string) =>
      `Best regards, ${recipient}. Until we meet again.`,
    playful: (recipient: string) =>
      `Catch you later, ${recipient}! Stay awesome!`,
    casual: (recipient: string) => `Goodbye ${recipient}, take care!`,
  },
  "thank-you": {
    formal: (recipient: string) =>
      `Dear ${recipient}, I sincerely appreciate your assistance.`,
    playful: (recipient: string) =>
      `You're the absolute best, ${recipient}! Thanks a million!`,
    casual: (recipient: string) =>
      `Thanks so much, ${recipient}! Really appreciate it!`,
  },
};

const createMessage = (args: CreateMessageArgs) => {
  if (!args.messageType) throw new Error("Must provide a message type.");
  if (!args.recipient) throw new Error("Must provide a recipient.");
  const { messageType, recipient } = args;
  const tone = args.tone ?? "casual";
  if (!messageTypes.includes(messageType)) {
    throw new Error(
      `Message type must be one of: ${messageTypes.join(", ")}`
    );
  }
  if (!tones.includes(tone)) {
    throw new Error(`Tone must be one of: ${tones.join(", ")}`);
  }
  const message = messageFns[messageType][tone](recipient);
  return {
    content: [{ type: "text" as const, text: message }],
  };
};

export const toolHandlers = {
  "create-message": createMessage,
};
