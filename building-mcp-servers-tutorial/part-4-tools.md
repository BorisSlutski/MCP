# Building MCP Servers: Part 4 — Creating Tools

**Source:** [Medium — Christopher Strolia-Davis](https://medium.com/@cstroliadavis/building-mcp-servers-f9ce29814f1f)  
**Date:** Feb 5, 2025

---

This is the final part of our 4-part tutorial on building MCP servers. In [Part 1](https://medium.com/@cstroliadavis/building-mcp-servers-536969d27809), we created our first MCP server with basic resources. [Part 2](https://medium.com/@cstroliadavis/building-mcp-servers-315917582ad1) added resource templates and improved code organization, and in [Part 3](https://medium.com/@cstroliadavis/building-mcp-servers-13570f347c74), we added prompts and further refined our structure. Now we'll complete our server by adding [tools](https://modelcontextprotocol.io/docs/concepts/tools).

## What are MCP Tools?

Tools are executable functions that LLMs can call to perform actions or retrieve dynamic information. Unlike resources, which are read-only, and prompts, which structure LLM interactions, tools allow LLMs to actively do things like calculate values, make API calls, or modify data.

## Why Use Tools?

Tools enable LLMs to interact with systems and perform actions. Examples: file operations (e.g. write-file with path and content), API interactions (e.g. fetch-weather with location and units), data processing (e.g. analyze-data with dataset and operation).

## Adding Tools

**src/tools.ts** — definitions and handler:

```typescript
// Allowed values
const messageTypes = ["greeting", "farewell", "thank-you"] as const;
const tones = ["formal", "casual", "playful"] as const;

export const tools = {
  "create-message": {
    name: "create-message",
    description: "Generate a custom message with various options",
    inputSchema: {
      type: "object",
      properties: {
        messageType: {
          type: "string",
          enum: messageTypes,
          description: "Type of message to generate",
        },
        recipient: {
          type: "string",
          description: "Name of the person to address",
        },
        tone: {
          type: "string",
          enum: tones,
          description: "Tone of the message",
        },
      },
      required: ["messageType", "recipient"],
    },
  },
};

type CreateMessageArgs = {
  messageType: (typeof messageTypes)[number];
  recipient: string;
  tone?: (typeof tones)[number];
};

const messageFns = {
  greeting: {
    formal: (recipient: string) => `Dear ${recipient}, I hope this message finds you well`,
    playful: (recipient: string) => `Hey hey ${recipient}! 🎉 What's shakin'?`,
    casual: (recipient: string) => `Hi ${recipient}! How are you?`,
  },
  farewell: {
    formal: (recipient: string) => `Best regards, ${recipient}. Until we meet again.`,
    playful: (recipient: string) => `Catch you later, ${recipient}! 👋 Stay awesome!`,
    casual: (recipient: string) => `Goodbye ${recipient}, take care!`,
  },
  "thank-you": {
    formal: (recipient: string) => `Dear ${recipient}, I sincerely appreciate your assistance.`,
    playful: (recipient: string) => `You're the absolute best, ${recipient}! 🌟 Thanks a million!`,
    casual: (recipient: string) => `Thanks so much, ${recipient}! Really appreciate it!`,
  },
};

const createMessage = (args: CreateMessageArgs) => {
  if (!args.messageType) throw new Error("Must provide a message type.");
  if (!args.recipient) throw new Error("Must provide a recipient.");
  const { messageType, recipient } = args;
  const tone = args.tone ?? "casual";
  if (!messageTypes.includes(messageType)) {
    throw new Error(`Message type must be one of: ${messageTypes.join(", ")}`);
  }
  if (!tones.includes(tone)) {
    throw new Error(`Tone must be one of: ${tones.join(", ")}`);
  }
  const message = messageFns[messageType][tone](recipient);
  return {
    content: [{ type: "text", text: message }],
  };
};

export const toolHandlers = {
  "create-message": createMessage,
};
```

Update **src/handlers.ts** — add imports and tool handlers:

```typescript
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  // ... other imports
} from "@modelcontextprotocol/sdk/types.js";
import { toolHandlers, tools } from "./tools.js";

// Inside setupHandlers:
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: params } = request.params ?? {};
    const handler = toolHandlers[name as keyof typeof toolHandlers];
    if (!handler) throw new Error("Tool not found");
    return handler(params as CreateMessageArgs);
  });
```

Update **src/index.ts** — add tools capability:

```typescript
capabilities: {
  resources: {},
  prompts: {},
  tools: {},
},
```

## Understanding the Code

**Tool Structure** — Tools define their interface through `inputSchema`. Handlers implement the actual functionality. Return format matches MCP specifications.

**Error Handling** — Validation of required arguments. Specific error messages. Type-safe handler access.

## Testing with the Inspector

```bash
npm run build
npx @modelcontextprotocol/inspector node build/index.js
```

In the Tools tab, find "create-message" and try e.g.:

```json
{
  "messageType": "thank-you",
  "recipient": "Alice",
  "tone": "playful"
}
```

## Testing with Claude Desktop

You may need to authorize tool usage. Try: "Create a greeting message for Bob" (basic), "Send a playful thank you to Alice" (styled), "What kinds of messages can you create?" (discovery). Results may vary by client and model.

## Wrapping Up

You've now built a complete MCP server with static and template-based resources, customizable prompts, dynamic tools, and well-organized, type-safe code. You've learned how to structure an MCP server, implement different MCP capabilities, organize code effectively, handle errors gracefully, test with the Inspector, and integrate with Claude Desktop.

From here you can add database connections, file operations, external APIs, more complex tools, and your own custom capabilities. MCP is an evolving protocol — keep an eye on the [official documentation](https://modelcontextprotocol.io/) for new features and best practices.

### Sources and additional reading

- [https://github.com/modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector)
- [https://github.com/modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- [https://modelcontextprotocol.io/docs/concepts/tools](https://modelcontextprotocol.io/docs/concepts/tools)
