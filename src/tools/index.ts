import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Tool definitions
import { agentToolDefinitions, handleAgentCreate } from "./agent-tools.js";
import { sonarToolDefinitions, handleSonarChat, handleSonarAsyncSubmit, handleSonarAsyncGet, handleSonarAsyncList } from "./sonar-tools.js";
import { searchToolDefinitions, handleWebSearch } from "./search-tools.js";
import { embeddingsToolDefinitions, handleEmbeddingsCreate, handleEmbeddingsContextualized } from "./embeddings-tools.js";
import { adminToolDefinitions, handleApiKeyGenerate, handleApiKeyRevoke, handleApiKeyRotate } from "./admin-tools.js";
import { utilityToolDefinitions, handleEstimateCost, handleListModels, handleHealthCheck } from "./utility-tools.js";

// ─── Unified Tool Registry ─────────────────────────────────────────────────────

const ALL_TOOLS = [
  ...agentToolDefinitions,
  ...sonarToolDefinitions,
  ...searchToolDefinitions,
  ...embeddingsToolDefinitions,
  ...adminToolDefinitions,
  ...utilityToolDefinitions,
];

type ToolHandler = (args: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  // Agent
  agent_create: handleAgentCreate,

  // Sonar
  sonar_chat: handleSonarChat,
  sonar_async_submit: handleSonarAsyncSubmit,
  sonar_async_get: handleSonarAsyncGet,
  sonar_async_list: handleSonarAsyncList,

  // Search
  web_search: handleWebSearch,

  // Embeddings
  embeddings_create: handleEmbeddingsCreate,
  embeddings_contextualized: handleEmbeddingsContextualized,

  // Admin
  api_key_generate: handleApiKeyGenerate,
  api_key_revoke: handleApiKeyRevoke,
  api_key_rotate: handleApiKeyRotate,

  // Utility
  estimate_cost: handleEstimateCost,
  list_models: handleListModels,
  health_check: handleHealthCheck,
};

// ─── Registration ──────────────────────────────────────────────────────────────

export function registerAllTools(server: Server): void {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Unknown tool: '${name}'`,
                available_tools: Object.keys(TOOL_HANDLERS),
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    try {
      return await handler(args ?? {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[tools] Error in ${name}:`, err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: `Tool '${name}' threw an unexpected error`,
                message,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  });
}

export { ALL_TOOLS, TOOL_HANDLERS };
