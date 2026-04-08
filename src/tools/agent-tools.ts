import { z } from "zod";
import { perplexityClient, formatResponse } from "../services/perplexity-client.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const FunctionToolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

const WebSearchToolSchema = z.object({
  type: z.literal("web_search"),
  web_search: z
    .object({
      search_context_size: z.enum(["low", "medium", "high"]).optional(),
      user_location: z
        .object({
          country: z.string().optional(),
          city: z.string().optional(),
          region: z.string().optional(),
          timezone: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

const FetchUrlToolSchema = z.object({
  type: z.literal("fetch_url"),
});

const AnyToolSchema = z.union([WebSearchToolSchema, FetchUrlToolSchema, FunctionToolSchema]);

const MessageContentPartSchema = z.union([
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(["low", "high", "auto"]).optional(),
    }),
  }),
]);

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([z.string(), z.array(MessageContentPartSchema)]),
});

const ReasoningSchema = z.object({
  effort: z.enum(["low", "medium", "high"]).optional(),
  max_tokens: z.number().int().positive().optional(),
  exclude: z.boolean().optional(),
});

const AgentCreateSchema = z.object({
  // Model selection (one of model, models, or preset required)
  model: z.string().optional().describe(
    "Model in provider/model format, e.g. 'openai/gpt-5.4'. Either model, models, or preset is required."
  ),
  models: z
    .array(z.string())
    .max(5)
    .optional()
    .describe("Fallback chain of models (max 5). Takes precedence over model."),
  preset: z
    .enum(["fast-search", "pro-search", "deep-research", "advanced-deep-research"])
    .optional()
    .describe("Preset configuration. Used if neither model nor models is specified."),

  // Input
  input: z
    .union([z.string(), z.array(MessageSchema)])
    .describe("The input message(s) — either a plain string or an array of message objects."),

  // Optional parameters
  instructions: z.string().optional().describe("System-level instructions for the agent."),
  tools: z.array(AnyToolSchema).optional().describe("Tools available to the agent."),
  stream: z.boolean().optional().default(false).describe("Stream the response (always false for MCP)."),
  max_output_tokens: z.number().int().positive().optional().describe("Maximum tokens in the response."),
  max_steps: z.number().int().min(1).max(10).optional().describe("Maximum number of agentic steps (1-10)."),
  reasoning: ReasoningSchema.optional().describe("Reasoning configuration."),
  response_format: z
    .object({
      type: z.enum(["text", "json_object", "json_schema"]),
      json_schema: z
        .object({
          name: z.string(),
          schema: z.record(z.unknown()),
          strict: z.boolean().optional(),
        })
        .optional(),
    })
    .optional()
    .describe("Structured output format configuration."),
  language_preference: z
    .string()
    .length(2)
    .optional()
    .describe("ISO 639-1 language code for response preference, e.g. 'en'."),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const agentToolDefinitions = [
  {
    name: "agent_create",
    description:
      "Create an agent response using the Perplexity Agent API (POST /v1/agent). " +
      "Supports multi-step agentic reasoning with web search, URL fetching, and custom function tools. " +
      "Either model, models, or preset must be provided.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string",
          description: "Model in provider/model format, e.g. 'openai/gpt-5.4'.",
        },
        models: {
          type: "array",
          items: { type: "string" },
          maxItems: 5,
          description: "Fallback chain of models (max 5). Takes precedence over model.",
        },
        preset: {
          type: "string",
          enum: ["fast-search", "pro-search", "deep-research", "advanced-deep-research"],
          description: "Preset configuration.",
        },
        input: {
          description: "Input string or array of message objects ({role, content}).",
        },
        instructions: {
          type: "string",
          description: "System-level instructions for the agent.",
        },
        tools: {
          type: "array",
          description: "Tools available to the agent (web_search, fetch_url, function).",
        },
        max_output_tokens: {
          type: "integer",
          description: "Maximum tokens in the response.",
        },
        max_steps: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Maximum number of agentic steps (1-10).",
        },
        reasoning: {
          type: "object",
          description: "Reasoning configuration object with optional 'effort' field.",
        },
        response_format: {
          type: "object",
          description: "Structured output format: {type: 'text'|'json_object'|'json_schema', json_schema?: {...}}",
        },
        language_preference: {
          type: "string",
          description: "ISO 639-1 language code, e.g. 'en', 'fr', 'es'.",
        },
      },
      required: ["input"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

export async function handleAgentCreate(args: unknown): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const parsed = AgentCreateSchema.safeParse(args);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: "Invalid parameters", issues: parsed.error.issues }, null, 2),
        },
      ],
    };
  }

  const params = parsed.data;

  // Validate that at least one of model/models/preset is provided
  if (!params.model && !params.models && !params.preset) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: "At least one of 'model', 'models', or 'preset' must be provided." },
            null,
            2
          ),
        },
      ],
    };
  }

  // Build request body, omitting undefined fields
  const body: Record<string, unknown> = {
    input: params.input,
    stream: false, // Always false for MCP
  };

  if (params.models && params.models.length > 0) {
    body["models"] = params.models;
  } else if (params.model) {
    body["model"] = params.model;
  } else if (params.preset) {
    body["preset"] = params.preset;
  }

  if (params.instructions !== undefined) body["instructions"] = params.instructions;
  if (params.tools !== undefined) body["tools"] = params.tools;
  if (params.max_output_tokens !== undefined) body["max_output_tokens"] = params.max_output_tokens;
  if (params.max_steps !== undefined) body["max_steps"] = params.max_steps;
  if (params.reasoning !== undefined) body["reasoning"] = params.reasoning;
  if (params.response_format !== undefined) body["response_format"] = params.response_format;
  if (params.language_preference !== undefined) body["language_preference"] = params.language_preference;

  const result = await perplexityClient.post("/v1/agent", body);
  return {
    content: [{ type: "text", text: formatResponse(result) }],
  };
}
