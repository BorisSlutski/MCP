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
      prompts: {},
      tools: {},
    },
  }
);

setupHandlers(server);

// Start server using stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
console.info('{"jsonrpc": "2.0", "method": "log", "params": { "message": "Server running..." }}');
