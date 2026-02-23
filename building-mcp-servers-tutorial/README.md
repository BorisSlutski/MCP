# Building MCP Servers — Tutorial

A consolidated guide based on the 4-part Medium series by **Christopher Strolia-Davis**. This README contains all setup and step-by-step instructions to build a full MCP server with resources, resource templates, prompts, and tools.

## Original articles

- [Part 1 — Getting Started with Resources](https://medium.com/@cstroliadavis/building-mcp-servers-536969d27809)
- [Part 2 — Extending Resources with Resource Templates](https://medium.com/@cstroliadavis/building-mcp-servers-315917582ad1)
- [Part 3 — Adding Prompts](https://medium.com/@cstroliadavis/building-mcp-servers-13570f347c74)
- [Part 4 — Creating Tools](https://medium.com/@cstroliadavis/building-mcp-servers-f9ce29814f1f)

Local copies with full article content: `part-1-resources.md`, `part-2-templates.md`, `part-3-prompts.md`, `part-4-tools.md`.

---

## Prerequisites

- **Node.js** and **npm**
- (Optional) **Claude for Desktop** — [download](https://claude.ai/download)
- (Optional) **MCP Inspector** — `npx @modelcontextprotocol/inspector` (no install needed)

---

## Part 1 — Setup and first resource

### 1. Create the project

```bash
mkdir hello-mcp
cd hello-mcp
npm init -y
npm install @modelcontextprotocol/sdk
npm install -D typescript @types/node
```

### 2. Configure package.json

- Remove the line `"main": "index.js"` (if present).
- Add `"type": "module"`.
- Under `"scripts"`, add `"build": "tsc"`.

### 3. Add tsconfig.json

Create `tsconfig.json` in the project root:

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

### 4. First resource server

Create `src/index.ts` with:

- Import `Server` from `@modelcontextprotocol/sdk/server/index.js`, `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`, and `ListResourcesRequestSchema`, `ReadResourceRequestSchema` from `@modelcontextprotocol/sdk/types.js`.
- Create a `Server` with name `"hello-mcp"`, version `"1.0.0"`, and `capabilities: { resources: {} }`.
- Set a handler for `ListResourcesRequestSchema` that returns one resource: `uri: "hello://world"`, `name: "Hello World Message"`, `description: "A simple greeting message"`, `mimeType: "text/plain"`.
- Set a handler for `ReadResourceRequestSchema` that for `uri === "hello://world"` returns `contents: [{ uri: "hello://world", text: "Hello, World! This is my first MCP resource." }]`, otherwise throws.
- Use `StdioServerTransport`, connect the server with `await server.connect(transport)`, and log that the server is running (e.g. via JSON-RPC log message).

See `part-1-resources.md` for the full code.

### 5. Build and run

```bash
npx tsc
```

---

## Part 2 — Resource templates

### 1. Extract handlers

- Create `src/handlers.ts` and move the `ListResourcesRequestSchema` and `ReadResourceRequestSchema` handlers into a function `setupHandlers(server: Server)`.
- In `src/index.ts`, import `setupHandlers` and call it after creating the server.

### 2. Add resource template

In `handlers.ts`:

- Add a handler for `ListResourceTemplatesRequestSchema` that returns one template: `uriTemplate: "greetings://{name}"`, `name: "Personal Greeting"`, `description: "A personalized greeting message"`, `mimeType: "text/plain"` (structure as in the SDK, e.g. under a `resourceTemplates` key).
- In the `ReadResourceRequestSchema` handler, add a branch: match the URI with a regex like `/^greetings:\/\/(.+)$/`, decode the name, and return `contents: [{ uri: request.params.uri, text: \`Hello, ${name}! Welcome to MCP.\` }]`.

See `part-2-templates.md` for exact code and `handlers.ts` / `index.ts` layout.

### 3. Build and test

```bash
npx tsc
npx @modelcontextprotocol/inspector node build/index.js
```

In the Inspector: list resources, list resource templates, read `hello://world` and `greetings://Alice`.

---

## Part 3 — Prompts

### 1. Refactor resources

- Create `src/resources.ts`: export a `resources` array (the static resource for `hello://world`) and `resourceHandlers` map for `ReadResourceRequestSchema` content.
- Create `src/resource-templates.ts`: export `resourceTemplates` array and a `getResourceTemplate(uri)` that returns a handler for template URIs (e.g. `greetings://{name}`).
- Update `src/handlers.ts` to use these modules: `ListResourcesRequestSchema` returns `resources`, `ListResourceTemplatesRequestSchema` returns `resourceTemplates`, and `ReadResourceRequestSchema` first checks `resourceHandlers[uri]`, then `getResourceTemplate(uri)`.

### 2. Add prompts

- Create `src/prompts.ts`: define a prompt `"create-greeting"` with arguments `name` (required) and `style` (optional, default `"casual"`). Export `prompts` (list/object for listing) and `promptHandlers` that for `"create-greeting"` return `messages: [{ role: "user", content: { type: "text", text: \`Please generate a greeting in ${style} style to ${name}.\` } }]`.
- In `handlers.ts`, add `ListPromptsRequestSchema` (return prompts) and `GetPromptRequestSchema` (call `promptHandlers[name](args)`).
- In `src/index.ts`, add `prompts: {}` to server capabilities.

See `part-3-prompts.md` for full code.

### 3. Build and test

```bash
npx tsc
npx @modelcontextprotocol/inspector node build/index.js
```

Test the "create-greeting" prompt in the Prompts tab with different `name` and `style` values.

---

## Part 4 — Tools

### 1. Add tools module

- Create `src/tools.ts` with a tool `"create-message"`: `inputSchema` with `messageType` (enum: greeting, farewell, thank-you), `recipient` (string), `tone` (optional, enum: formal, casual, playful). Implement a handler that returns `content: [{ type: "text", text: message }]` using simple templates for each messageType/tone combination.
- Export `tools` (for listing) and `toolHandlers` (for execution).

### 2. Wire tools in handlers and server

- In `handlers.ts`, add `ListToolsRequestSchema` (return `Object.values(tools)`) and `CallToolRequestSchema` (get handler by name, call with `request.params.arguments`, return result).
- In `src/index.ts`, add `tools: {}` to server capabilities.

See `part-4-tools.md` for full tool definitions and handler code.

### 3. Build and test

```bash
npm run build
npx @modelcontextprotocol/inspector node build/index.js
```

In the Tools tab, call `create-message` with e.g. `messageType: "thank-you"`, `recipient: "Alice"`, `tone: "playful"`.

---

## Testing

### MCP Inspector

1. Build: `npx tsc` (or `npm run build`).
2. Run: `npx @modelcontextprotocol/inspector node build/index.js`.
3. Click **Connect**.
4. Use **Resources**, **Resource Templates**, **Prompts**, and **Tools** tabs to list and invoke capabilities.

### Claude Desktop

1. Open Claude for Desktop → **Settings** → **Developer** → **Edit Config**.
2. Add your server (use the **absolute** path to `build/index.js`):

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

3. Restart Claude.
4. In a chat, use **Attach from MCP** to attach resources or prompts, and let Claude use the tools when it chooses (you may need to authorize tool usage).

Note: Some Claude Desktop builds may have limited MCP support; MCP Inspector is the most reliable way to verify all capabilities.

---

## Final project layout

```
hello-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── handlers.ts
│   ├── resources.ts
│   ├── resource-templates.ts
│   ├── prompts.ts
│   └── tools.ts
└── build/
    └── (compiled .js files)
```

---

## References

- [Model Context Protocol — Introduction](https://modelcontextprotocol.io/introduction)
- [MCP — Quickstart (server)](https://modelcontextprotocol.io/quickstart/server)
- [MCP — Resources](https://modelcontextprotocol.io/docs/concepts/resources)
- [MCP — Prompts](https://modelcontextprotocol.io/docs/concepts/prompts)
- [MCP — Tools](https://modelcontextprotocol.io/docs/concepts/tools)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Claude for Desktop — Installing](https://support.anthropic.com/en/articles/10065433-installing-claude-for-desktop)
