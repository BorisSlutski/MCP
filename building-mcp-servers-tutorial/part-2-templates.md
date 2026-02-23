# Building MCP Servers: Part 2 — Extending Resources with Resource Templates

**Source:** [Medium — Christopher Strolia-Davis](https://medium.com/@cstroliadavis/building-mcp-servers-315917582ad1)  
**Date:** Jan 4, 2025

---

This is part 2 of a 4-part tutorial on building [MCP servers](https://modelcontextprotocol.io/quickstart/server). In [Part 1](https://medium.com/@cstroliadavis/building-mcp-servers-536969d27809), we created our first MCP server with a [basic resource](https://modelcontextprotocol.io/docs/concepts/resources#resource-uris). Now we'll extend our server's capabilities using [resource templates](https://modelcontextprotocol.io/docs/concepts/resources#resource-templates). The code in this post assumes you are continuing from where we left off.

## What are Resource Templates?

Resource templates allow you to define dynamic resources using URI patterns. Unlike static resources that have fixed URIs, templates let you create resources whose URIs and content can be generated based on parameters.

Think of them like URL patterns in a web framework where the resource is a bit more dynamic and usually based on some tag or id — they let you match and handle whole families of resources using a single definition.

## Why Use Resource Templates?

Resource templates are powerful when you need dynamic data, generate content on demand, or create parameter-based resources.

**Dynamic Data**

- `"users://{userId}"` → User profiles  
- `"products://{sku}"` → Product information  

**Generate Content On-Demand**

- `"reports://{year}/{month}"` → Monthly reports  
- `"analytics://{dateRange}"` → Custom analytics  

**Parameter-Based Resources**

- `"search://{query}"` → Search results  
- `"filter://{type}/{value}"` → Filtered data  

## Organizing Our Code

Break our handlers out into a new file (`handlers.ts`) so we won't have as much clutter:

**src/handlers.ts**

```typescript
// src/handlers.ts
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type Server } from "@modelcontextprotocol/sdk/server/index.js";

export const setupHandlers = (server: Server): void => {
  // List available resources when clients request them
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: "hello://world",
          name: "Hello World Message",
          description: "A simple greeting message",
          mimeType: "text/plain",
        },
      ],
    };
  });

  // Resource Templates
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: [
      {
        uriTemplate: "greetings://{name}",
        name: "Personal Greeting",
        description: "A personalized greeting message",
        mimeType: "text/plain",
      },
    ],
  }));

  // Return resource content when clients request it
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "hello://world") {
      return {
        contents: [
          {
            uri: "hello://world",
            text: "Hello, World! This is my first MCP resource.",
          },
        ],
      };
    }
    // Template-based resource
    const greetingExp = /^greetings:\/\/(.+)$/;
    const greetingMatch = request.params.uri.match(greetingExp);
    if (greetingMatch) {
      const name = decodeURIComponent(greetingMatch[1]);
      return {
        contents: [
          {
            uri: request.params.uri,
            text: `Hello, ${name}! Welcome to MCP.`,
          },
        ],
      };
    }
    throw new Error("Resource not found");
  });
};
```

**src/index.ts**

```typescript
// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { setupHandlers } from "./handlers.js";

const server = new Server(
  {
    name: "hello-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
    },
  }
);

setupHandlers(server);

// Start server using stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.info('{"jsonrpc": "2.0", "method": "log", "params": { "message": "Server running..." }}');
```

## Understanding the Code

**Handler Organization** — We've moved handlers to a separate file for better organization. The `setupHandlers` function encapsulates all handler setup. Main file stays clean and focused.

**Template Definition** — The `ListResourceTemplatesRequestSchema` handler exposes available templates. The template format follows [RFC 6570](https://www.rfc-editor.org/rfc/rfc6570) (a URL that uses `{text}` to express parameterization). Templates include metadata like name and description.

**Template Handling** — The `ReadResourceRequestSchema` handler now checks for template matches. We're using regex to extract the name parameter from the URI. We generate dynamic content based on parameters.

## Testing with the Inspector

Launch the inspector:

```bash
npx tsc
npx @modelcontextprotocol/inspector node build/index.js
```

Test the static resource: click "Resources" tab, find and click "Hello World Message" — you should see "Hello, World! This is my first MCP resource."

Test the template: click "Resource Templates" tab, find "Personal Greeting", type the name "Alice". You should get:

```json
{
  "contents": [
    {
      "uri": "greetings://Alice",
      "text": "Hello, Alice! Welcome to MCP."
    }
  ]
}
```

## Testing with Claude Desktop

You should not need to update anything in Claude, but you may have to reload (and make sure you've built the service with `npx tsc`). Try examples like: "What's in the greeting message?" (static resource), "Can you get a greeting for Alice?" (template), "What resources and templates are available?"

## What's Next?

In [Part 3](https://medium.com/@cstroliadavis/building-mcp-servers-13570f347c74), we'll see how prompts can enhance our greeting functionality, add prompt capabilities to our server, learn about MCP prompts and how they differ from resources, and further improve code organization by separating resources and templates into their own files.

[Part 4](https://medium.com/@cstroliadavis/building-mcp-servers-f9ce29814f1f) will then complete our course by adding tools to our server.

### Resources and additional reading

- [https://www.rfc-editor.org/rfc/rfc6570](https://www.rfc-editor.org/rfc/rfc6570)
- [https://modelcontextprotocol.io/](https://modelcontextprotocol.io/)
