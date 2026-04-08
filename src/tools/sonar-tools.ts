import { z } from "zod";
import { perplexityClient, formatResponse } from "../services/perplexity-client.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const SonarModelSchema = z.enum([
  "sonar",
  "sonar-pro",
  "sonar-reasoning",
  "sonar-reasoning-pro",
  "sonar-deep-research",
]);

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.union([
    z.string(),
    z.array(
      z.object({
        type: z.enum(["text", "image_url"]),
        text: z.string().optional(),
        image_url: z
          .object({ url: z.string(), detail: z.enum(["low", "high", "auto"]).optional() })
          .optional(),
      })
    ),
  ]),
});

const UserLocationSchema = z.object({
  country: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  timezone: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const SonarChatSchema = z.object({
  model: SonarModelSchema.default("sonar").describe("Sonar model to use."),
  messages: z.array(MessageSchema).min(1).describe("Conversation messages."),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  search_domain_filter: z
    .array(z.string())
    .optional()
    .describe("Whitelist/blacklist domains. Prefix with '-' to exclude."),
  search_recency_filter: z.enum(["day", "week", "month", "year"]).optional(),
  return_images: z.boolean().optional(),
  search_after_date_filter: z.string().optional().describe("ISO 8601 date string."),
  search_before_date_filter: z.string().optional().describe("ISO 8601 date string."),
  user_location: UserLocationSchema.optional(),
  search_language_filter: z.string().optional().describe("BCP 47 language tag, e.g. 'en-US'."),
});

const SonarAsyncSubmitSchema = SonarChatSchema;

const SonarAsyncGetSchema = z.object({
  request_id: z.string().min(1).describe("The async job request ID to retrieve."),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const sonarToolDefinitions = [
  {
    name: "sonar_chat",
    description:
      "Chat completions with live web grounding using Perplexity Sonar models (POST /v1/sonar). " +
      "Supports domain filters, recency filters, and location-aware search.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string",
          enum: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
          description: "Sonar model to use.",
          default: "sonar",
        },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant", "system"] },
              content: { description: "Message content (string or array of content parts)." },
            },
            required: ["role", "content"],
          },
          description: "Conversation messages.",
        },
        max_tokens: { type: "integer", description: "Maximum tokens in the response." },
        temperature: { type: "number", minimum: 0, maximum: 2, description: "Sampling temperature." },
        top_p: { type: "number", minimum: 0, maximum: 1, description: "Nucleus sampling probability." },
        search_domain_filter: {
          type: "array",
          items: { type: "string" },
          description: "Domain whitelist/blacklist. Prefix with '-' to exclude, e.g. '-reddit.com'.",
        },
        search_recency_filter: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Restrict results to recent content.",
        },
        return_images: { type: "boolean", description: "Include image results." },
        search_after_date_filter: { type: "string", description: "Only search content after this ISO 8601 date." },
        search_before_date_filter: { type: "string", description: "Only search content before this ISO 8601 date." },
        user_location: {
          type: "object",
          description: "User's location for localized results.",
          properties: {
            country: { type: "string" },
            city: { type: "string" },
            region: { type: "string" },
            timezone: { type: "string" },
          },
        },
        search_language_filter: { type: "string", description: "BCP 47 language tag, e.g. 'en-US'." },
      },
      required: ["messages"],
    },
  },
  {
    name: "sonar_async_submit",
    description:
      "Submit an asynchronous deep research job (POST /v1/async/sonar). " +
      "Returns a request_id to poll with sonar_async_get. Ideal for sonar-deep-research model.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string",
          enum: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro", "sonar-deep-research"],
          default: "sonar-deep-research",
        },
        messages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string", enum: ["user", "assistant", "system"] },
              content: { description: "Message content." },
            },
            required: ["role", "content"],
          },
        },
        max_tokens: { type: "integer" },
        temperature: { type: "number", minimum: 0, maximum: 2 },
        top_p: { type: "number", minimum: 0, maximum: 1 },
        search_domain_filter: { type: "array", items: { type: "string" } },
        search_recency_filter: { type: "string", enum: ["day", "week", "month", "year"] },
        return_images: { type: "boolean" },
        search_after_date_filter: { type: "string" },
        search_before_date_filter: { type: "string" },
        user_location: { type: "object" },
        search_language_filter: { type: "string" },
      },
      required: ["messages"],
    },
  },
  {
    name: "sonar_async_get",
    description: "Get the status or result of an async Sonar job (GET /v1/async/sonar/{request_id}).",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: { type: "string", description: "The request ID from sonar_async_submit." },
      },
      required: ["request_id"],
    },
  },
  {
    name: "sonar_async_list",
    description: "List all async Sonar jobs (GET /v1/async/sonar).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

function buildSonarBody(params: z.infer<typeof SonarChatSchema>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    stream: false,
  };
  if (params.max_tokens !== undefined) body["max_tokens"] = params.max_tokens;
  if (params.temperature !== undefined) body["temperature"] = params.temperature;
  if (params.top_p !== undefined) body["top_p"] = params.top_p;
  if (params.search_domain_filter !== undefined) body["search_domain_filter"] = params.search_domain_filter;
  if (params.search_recency_filter !== undefined) body["search_recency_filter"] = params.search_recency_filter;
  if (params.return_images !== undefined) body["return_images"] = params.return_images;
  if (params.search_after_date_filter !== undefined) body["search_after_date_filter"] = params.search_after_date_filter;
  if (params.search_before_date_filter !== undefined) body["search_before_date_filter"] = params.search_before_date_filter;
  if (params.user_location !== undefined) body["user_location"] = params.user_location;
  if (params.search_language_filter !== undefined) body["search_language_filter"] = params.search_language_filter;
  return body;
}

type ToolResult = { content: Array<{ type: "text"; text: string }> };

export async function handleSonarChat(args: unknown): Promise<ToolResult> {
  const parsed = SonarChatSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid parameters", issues: parsed.error.issues }, null, 2) }] };
  }
  const result = await perplexityClient.post("/v1/sonar", buildSonarBody(parsed.data));
  return { content: [{ type: "text", text: formatResponse(result) }] };
}

export async function handleSonarAsyncSubmit(args: unknown): Promise<ToolResult> {
  const parsed = SonarAsyncSubmitSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid parameters", issues: parsed.error.issues }, null, 2) }] };
  }
  const requestBody = buildSonarBody(parsed.data);
  const result = await perplexityClient.post("/v1/async/sonar", { request: requestBody });
  return { content: [{ type: "text", text: formatResponse(result) }] };
}

export async function handleSonarAsyncGet(args: unknown): Promise<ToolResult> {
  const parsed = SonarAsyncGetSchema.safeParse(args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Invalid parameters", issues: parsed.error.issues }, null, 2) }] };
  }
  const result = await perplexityClient.get(`/v1/async/sonar/${encodeURIComponent(parsed.data.request_id)}`);
  return { content: [{ type: "text", text: formatResponse(result) }] };
}

export async function handleSonarAsyncList(_args: unknown): Promise<ToolResult> {
  const result = await perplexityClient.get("/v1/async/sonar");
  return { content: [{ type: "text", text: formatResponse(result) }] };
}
