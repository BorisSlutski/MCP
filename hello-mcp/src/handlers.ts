import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { type Server } from "@modelcontextprotocol/sdk/server/index.js";
import { resourceHandlers, resources } from "./resources.js";
import {
  getResourceTemplate,
  resourceTemplates,
} from "./resource-templates.js";
import { promptHandlers, prompts } from "./prompts.js";
import {
  toolHandlers,
  tools,
  type CreateMessageArgs,
} from "./tools.js";

export const setupHandlers = (server: Server): void => {
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources }));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates,
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const { uri } = request.params ?? {};
    const resourceHandler =
      resourceHandlers[uri as keyof typeof resourceHandlers];
    if (resourceHandler) return resourceHandler();
    const resourceTemplateHandler = getResourceTemplate(uri);
    if (resourceTemplateHandler) return resourceTemplateHandler();
    throw new Error("Resource not found");
  });

  server.setRequestHandler(ListPromptsRequestSchema, () => ({
    prompts: Object.values(prompts),
  }));

  server.setRequestHandler(GetPromptRequestSchema, (request) => {
    const { name, arguments: args } = request.params;
    const promptHandler = promptHandlers[name as keyof typeof promptHandlers];
    if (promptHandler)
      return promptHandler(args as { name: string; style?: string });
    throw new Error("Prompt not found");
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params ?? {};
    const handler = toolHandlers[name as keyof typeof toolHandlers];
    if (!handler) throw new Error("Tool not found");
    return handler((args ?? {}) as CreateMessageArgs);
  });
};
