# Building MCP Servers: Part 3 — Adding Prompts

**Source:** [Medium — Christopher Strolia-Davis](https://medium.com/@cstroliadavis/building-mcp-servers-13570f347c74)  
**Date:** Jan 12, 2025

---

This is part 3 of our 4-part tutorial on building MCP servers. In [Part 1](https://medium.com/@cstroliadavis/building-mcp-servers-536969d27809), we created our first [MCP server](https://modelcontextprotocol.io/quickstart/server) with a [basic resource](https://modelcontextprotocol.io/docs/concepts/resources), and in [Part 2](https://medium.com/@cstroliadavis/building-mcp-servers-315917582ad1), we added [resource templates](https://modelcontextprotocol.io/docs/concepts/resources#resource-templates) and improved our code organization. Now we'll refactor our code further and add [prompt capabilities](https://modelcontextprotocol.io/docs/concepts/prompts).

## What are MCP Prompts?

Prompts in MCP are structured templates that servers provide to standardize interactions with language models. Unlike resources which provide data, or tools which execute actions, prompts define reusable message sequences and workflows that help guide LLM behavior in consistent, predictable ways. They can accept arguments to customize the interaction while maintaining a standardized structure.

If you've ever researched prompt engineering, you likely have a pretty decent idea of what a prompt is. Creating these within an MCP server allows us to create a space for the prompts we find the most useful to be easily reused and even shared. If you imagine going to a restaurant, a prompt is like a menu item that you can pick from and provide to the waiter. Sometimes, you can customize the menu items by asking to add or remove certain items or to cook the result a particular way. Prompts provided this way serve a similar function.

## Why Use Prompts?

Prompts help create consistent, reusable patterns for LLM interactions. Examples: code review prompts (review following {{language}} code focusing on {{focusAreas}}), data analysis prompts (analyze {{timeframe}} sales data focusing on {{metrics}}), content generation prompts (generate a {{tone}} {{type}} email for {{context}}).

## Code Organization

We should organize our handler code into focused modules.

**src/resources.ts**

```typescript
export const resources = [
  {
    uri: "hello://world",
    name: "Hello World Message",
    description: "A simple greeting message",
    mimeType: "text/plain",
  },
];

export const resourceHandlers: Record<string, () => { contents: Array<{ uri: string; text: string }> }> = {
  "hello://world": () => ({
    contents: [
      {
        uri: "hello://world",
        text: "Hello, World! This is my first MCP resource.",
      },
    ],
  }),
};
```

**src/resource-templates.ts**

```typescript
export const resourceTemplates = [
  {
    uriTemplate: "greetings://{name}",
    name: "Personal Greeting",
    description: "A personalized greeting message",
    mimeType: "text/plain",
  },
];

const greetingExp = /^greetings:\/\/(.+)$/;

const greetingMatchHandler = (uri: string, matchText: RegExpMatchArray) => () => {
  const name = decodeURIComponent(matchText[1]);
  return {
    contents: [
      {
        uri,
        text: `Hello, ${name}! Welcome to MCP.`,
      },
    ],
  };
};

export const getResourceTemplate = (uri: string) => {
  const greetingMatch = uri.match(greetingExp);
  if (greetingMatch) return greetingMatchHandler(uri, greetingMatch);
  return null;
};
```

**src/handlers.ts** (update to use resources and resource-templates)

```typescript
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type Server } from "@modelcontextprotocol/sdk/server/index.js";
import { resourceHandlers, resources } from "./resources.js";
import { getResourceTemplate, resourceTemplates } from "./resource-templates.js";

export const setupHandlers = (server: Server): void => {
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates,
  }));
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const { uri } = request.params ?? {};
    const resourceHandler = resourceHandlers[uri as keyof typeof resourceHandlers];
    if (resourceHandler) return resourceHandler();
    const resourceTemplateHandler = getResourceTemplate(uri);
    if (resourceTemplateHandler) return resourceTemplateHandler();
    throw new Error("Resource not found");
  });
};
```

## Adding Prompts

**src/prompts.ts**

```typescript
export const prompts = {
  "create-greeting": {
    name: "create-greeting",
    description: "Generate a customized greeting message",
    arguments: [
      {
        name: "name",
        description: "Name of the person to greet",
        required: true,
      },
      {
        name: "style",
        description: "The style of greeting, such as formal, excited, or casual. If not specified casual will be used",
      },
    ],
  },
};

export const promptHandlers = {
  "create-greeting": ({ name, style = "casual" }: { name: string; style?: string }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Please generate a greeting in ${style} style to ${name}.`,
          },
        },
      ],
    };
  },
};
```

Add prompt handlers to **src/handlers.ts**:

```typescript
import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  // ... other imports
} from "@modelcontextprotocol/sdk/types.js";
import { promptHandlers, prompts } from "./prompts.js";

// Inside setupHandlers:
  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: Object.values(prompts),
  }));
  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    const promptHandler = promptHandlers[name as keyof typeof promptHandlers];
    if (promptHandler) return promptHandler(args as { name: string; style?: string });
    throw new Error("Prompt not found");
  });
```

Update **src/index.ts** — add prompts capability:

```typescript
capabilities: {
  prompts: {},
  resources: {},
},
```

## Understanding the Code

**Module Organization** — Resources and templates have been placed in their own modules. Prompts are cleanly separated. Handlers are now acting as a routing layer.

**Prompt Structure** — Each prompt has a name, description, and arguments if needed. Arguments describe the expected inputs for a prompt. Handlers generate structured message(s) for prompting the target AI.

**Message Sequences** — Messages have roles ('user' or 'assistant'). Prompts return arrays of messages. Content can include both the initial request and subsequent responses for multi-step workflows (multi-step has limited support at this time).

## Testing with the Inspector

Launch the Inspector: `npx @modelcontextprotocol/inspector node build/index.js`

In the Prompts tab, find "create-greeting" and try e.g. `name: "Alice"`, `style: "excited"`. You should see a response like:

```json
{
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "Please generate a greeting in excited style to Alice."
      }
    }
  ]
}
```

## Testing with Claude Desktop

Open "Attach from MCP", choose the "create-greeting" prompt from "hello-mcp", enter a name (e.g. "John") and submit — you should see a casual greeting. Try again with name "Alice" and style "formal" for a more formal message.

## What's Next?

In [Part 4](https://medium.com/@cstroliadavis/building-mcp-servers-f9ce29814f1f), we'll complete our greeting server with all primary MCP capabilities, see how tools can provide dynamic functionality, add tool capabilities to our server, and learn about [MCP tools](https://modelcontextprotocol.io/docs/concepts/tools) and how they differ from prompts.

### Sources and additional reading

- [https://modelcontextprotocol.io/docs/concepts/prompts](https://modelcontextprotocol.io/docs/concepts/prompts)
- [https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
