# Building MCP Servers: Part 1 — Getting Started with Resources

**Source:** [Medium — Christopher Strolia-Davis](https://medium.com/@cstroliadavis/building-mcp-servers-536969d27809)  
**Date:** Dec 27, 2024

---

## What is the Model Context Protocol?

The [Model Context Protocol](https://modelcontextprotocol.io/introduction) (MCP) is a standardized way for Large Language Models (LLMs) like [Claude](https://claude.ai/) to safely interact with external data and functionality. Think of it like a heads-up display, or a USB port for AI — it provides a common interface that lets any MCP-compatible LLM connect to your data and tools.

MCP provides a centralized protocol that streamlines the development of plug-and-play services for AI. Unlike other integration methods that might require custom implementations for each AI model, MCP offers a standardized approach that will work across different LLMs.

Without interfaces like MCP, LLMs are limited to their built-in capabilities and training data. With MCP, they can be empowered to:

- Interact with local tools
- Access APIs
- Execute commands
- Read files and databases
- And more!

All of this happens with user oversight and permission, making it both powerful and secure.

In this tutorial, we'll start with something fundamental to [MCP: Resources](https://modelcontextprotocol.io/docs/concepts/resources).

## What are MCP Resources?

Resources are MCP's way of exposing read-only data to LLMs. A resource is anything that has content that can be read, such as:

- System information
- Application data
- API responses
- Database records
- Files on your computer

Each resource has:

- A unique URI (like `file:///example.txt` or `database://users/123`)
- A display name
- Content (text or binary data)
- Optional metadata (description, MIME type)

## Why Use Resources?

Resources let you expose data to LLMs in a controlled, standardized way. Here are some real-world examples:

**Documentation Server**

- `"docs://api/reference"` → API documentation  
- `"docs://guides/getting-started"` → User guides  

**Log Analysis Server**

- `"logs://system/today"` → Today's system logs  
- `"logs://errors/recent"` → Recent error messages  

**Customer Data Server**

- `"customers://profiles/summary"` → Customer overview  
- `"customers://feedback/recent"` → Latest feedback  

## Getting Started

First, create a new directory and initialize a TypeScript project:

```bash
mkdir hello-mcp
cd hello-mcp
npm init -y
npm install @modelcontextprotocol/sdk
npm install -D typescript @types/node
```

Open the directory in your favorite IDE.

Let's open `package.json` and make some modifications. Remove the line that says `"main": "index.js"`. Add a new line in its place that reads `"type": "module"`. Finally, under `"scripts"` add a script called `"build"` and set its value to `"tsc"`.

```json
{
  "name": "hello-mcp",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "description": "",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "typescript": "^5.7.2"
  }
}
```

Finally, create a file named `tsconfig.json` and add the following code:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"]
}
```

Now the environment is set up and ready for coding.

## Creating Your First Resource Server

Create a new index file in src (`src/index.ts`) and add the following code:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Initialize server with resource capabilities
const server = new Server(
  {
    name: "hello-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {}, // Enable resources
    },
  }
);

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
  throw new Error("Resource not found");
});

// Start server using stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.info('{"jsonrpc": "2.0", "method": "log", "params": { "message": "Server running..." }}');
```

## Understanding the Code

**Server Configuration** — We create a server instance with a name and version. We enable the resources capability. Other capabilities such as prompts and tools will be covered later.

**Resource Listing** — The `ListResourcesRequestSchema` handler tells clients what resources exist. Each resource has a `uri`, `name`, and optional `description`/`mimeType`. Clients use this to discover available resources.

**Resource Reading** — The `ReadResourceRequestSchema` handler returns resource content. It takes a URI and returns matching content. Content includes the URI and the actual data.

**Transport** — We use stdio transport for local communication. This is standard for desktop MCP implementations.

## Testing Your MCP Server

### Setting Up Claude Desktop

1. Install Claude for Desktop if you haven't already.
2. Open Claude and access Settings.
3. Go to the Developer tab.
4. You'll see a list of currently configured MCP servers.
5. Click "Edit Config" to show the configuration file in your system's file viewer.
6. Open the configuration file in your default editor to add your MCP server configuration.
7. Add the following to your configuration:

```json
{
  "mcpServers": {
    "hello-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/your/hello-mcp/build/index.js"]
    }
  }
}
```

8. Build and run: `npx tsc`
9. Restart Claude for Desktop.
10. When you begin a chat with Claude, select the MCP resource connection.
11. Then select your resource — your resource will appear as an attachment.

### Using the MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a development tool that lets you test all MCP capabilities. The Inspector provides a user interface where you can view available resources and their content, debug server responses, and verify your implementation.

1. Launch the Inspector: `npx @modelcontextprotocol/inspector node build/index.js`
2. Click on the "Connect" button underneath the "Environment Variables" list on the left.
3. You should see the "Resources" tab. Click "List Resources" to see the resource you've created.
4. When you click on the greeting resource you will view its content.

You'll see the same responses we designed: resource listing shows "Hello World Message"; reading the resource returns "Hello, World! This is my first MCP resource."

## What's Next?

In [Part 2](https://medium.com/@cstroliadavis/building-mcp-servers-315917582ad1), we will learn advanced resource patterns and best practices, see how to handle multiple resources efficiently, begin organizing our code better by splitting handlers into separate files, and add dynamic resources using resource templates.

Parts 3 and 4 will then cover prompts and tools, completing your MCP server toolkit.

### Sources and additional reading

- [https://claude.ai/download](https://claude.ai/download)
- [https://modelcontextprotocol.io/quickstart/server](https://modelcontextprotocol.io/quickstart/server)
- [https://modelcontextprotocol.io/quickstart/user](https://modelcontextprotocol.io/quickstart/user)
- [https://support.anthropic.com/en/articles/10065433-installing-claude-for-desktop](https://support.anthropic.com/en/articles/10065433-installing-claude-for-desktop)
