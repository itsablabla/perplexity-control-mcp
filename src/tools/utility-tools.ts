import { z } from "zod";
import { perplexityClient, isApiError, MODEL_PRICING } from "../services/perplexity-client.js";

// ─── Model Catalog ─────────────────────────────────────────────────────────────

const MODEL_CATALOG = [
  // ── Sonar (search-grounded) ──────────────────────────────────────────────────
  {
    id: "sonar",
    category: "sonar",
    description: "Fast, lightweight search-grounded model. Best for quick Q&A.",
    context_length: 200_000,
    pricing: { input_per_million: 1.0, output_per_million: 1.0, per_request: 0.005 },
    supports_streaming: true,
    supports_async: true,
  },
  {
    id: "sonar-pro",
    category: "sonar",
    description: "Higher quality search-grounded model with more nuanced answers.",
    context_length: 200_000,
    pricing: { input_per_million: 3.0, output_per_million: 15.0, per_request: 0.005 },
    supports_streaming: true,
    supports_async: true,
  },
  {
    id: "sonar-reasoning",
    category: "sonar",
    description: "Sonar with chain-of-thought reasoning capability.",
    context_length: 128_000,
    pricing: { input_per_million: 1.0, output_per_million: 5.0, per_request: 0.005 },
    supports_streaming: true,
    supports_async: false,
  },
  {
    id: "sonar-reasoning-pro",
    category: "sonar",
    description: "High-capability reasoning model with web search grounding.",
    context_length: 128_000,
    pricing: { input_per_million: 2.0, output_per_million: 8.0, per_request: 0.005 },
    supports_streaming: true,
    supports_async: false,
  },
  {
    id: "sonar-deep-research",
    category: "sonar",
    description: "Multi-step deep research agent. Best for comprehensive reports.",
    context_length: 128_000,
    pricing: { input_per_million: 2.0, output_per_million: 8.0, per_request: 0.005 },
    supports_streaming: true,
    supports_async: true,
    notes: "Can take several minutes; use sonar_async_submit for long tasks.",
  },
  // ── Embeddings ──────────────────────────────────────────────────────────────
  {
    id: "pplx-embed-v1-0.6b",
    category: "embeddings",
    description: "Fast, compact embedding model (0.6B params).",
    max_dimensions: 2560,
    pricing: { input_per_million: 0.004, output_per_million: 0 },
    supports_streaming: false,
    supports_async: false,
  },
  {
    id: "pplx-embed-v1-4b",
    category: "embeddings",
    description: "High-quality embedding model (4B params). Better for complex semantic tasks.",
    max_dimensions: 2560,
    pricing: { input_per_million: 0.03, output_per_million: 0 },
    supports_streaming: false,
    supports_async: false,
  },
  {
    id: "pplx-embed-context-v1-0.6b",
    category: "embeddings_contextualized",
    description: "Contextualized document embedding model (0.6B params). Uses surrounding chunks.",
    max_dimensions: 2560,
    pricing: { input_per_million: 0.008, output_per_million: 0 },
    supports_streaming: false,
    supports_async: false,
  },
  {
    id: "pplx-embed-context-v1-4b",
    category: "embeddings_contextualized",
    description: "Contextualized document embedding model (4B params). Higher quality than 0.6b.",
    max_dimensions: 2560,
    pricing: { input_per_million: 0.05, output_per_million: 0 },
    supports_streaming: false,
    supports_async: false,
  },
] as const;

// ─── Schemas ──────────────────────────────────────────────────────────────────

const EstimateCostSchema = z.object({
  model: z.string().describe("Model ID to estimate cost for."),
  input_tokens: z.number().int().min(0).describe("Number of input tokens."),
  output_tokens: z.number().int().min(0).optional().default(0).describe("Number of output tokens."),
  tool_invocations: z
    .object({
      web_search: z.number().int().min(0).optional().default(0).describe("Number of web search tool calls."),
      fetch_url: z.number().int().min(0).optional().default(0).describe("Number of fetch_url tool calls."),
    })
    .optional()
    .default({ web_search: 0, fetch_url: 0 }),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const utilityToolDefinitions = [
  {
    name: "estimate_cost",
    description:
      "Estimate the USD cost of a request before sending it. " +
      "Returns a breakdown by input tokens, output tokens, and tool invocations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        model: {
          type: "string",
          description: "Model ID to estimate cost for (e.g. 'sonar', 'sonar-pro').",
        },
        input_tokens: {
          type: "integer",
          minimum: 0,
          description: "Number of input (prompt) tokens.",
        },
        output_tokens: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Number of output (completion) tokens.",
        },
        tool_invocations: {
          type: "object",
          description: "Tool invocation counts (for models that bill per tool call).",
          properties: {
            web_search: { type: "integer", minimum: 0, default: 0 },
            fetch_url: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
      required: ["model", "input_tokens"],
    },
  },
  {
    name: "list_models",
    description:
      "List all available Perplexity models with descriptions, context lengths, and current pricing. " +
      "Prices are in USD per million tokens.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "health_check",
    description:
      "Test API connectivity and verify the configured PERPLEXITY_API_KEY is valid and working. " +
      "Makes a minimal test request to the Sonar API.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }> };

export async function handleEstimateCost(args: unknown): Promise<ToolResult> {
  const parsed = EstimateCostSchema.safeParse(args);
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

  const { model, input_tokens, output_tokens, tool_invocations } = parsed.data;
  const pricing = MODEL_PRICING[model];

  if (!pricing) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              warning: `No pricing data found for model '${model}'. Available models: ${Object.keys(MODEL_PRICING).join(", ")}`,
              model,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const inputCost = (input_tokens / 1_000_000) * pricing.input;
  const outputCost = (output_tokens / 1_000_000) * pricing.output;
  const webSearchCost = (tool_invocations?.web_search ?? 0) * 0.005; // ~$0.005 per search
  const fetchUrlCost = (tool_invocations?.fetch_url ?? 0) * 0.001;   // estimated

  const totalCost = inputCost + outputCost + webSearchCost + fetchUrlCost;

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            model,
            breakdown: {
              input_tokens,
              input_cost_usd: parseFloat(inputCost.toFixed(6)),
              output_tokens,
              output_cost_usd: parseFloat(outputCost.toFixed(6)),
              web_search_calls: tool_invocations?.web_search ?? 0,
              web_search_cost_usd: parseFloat(webSearchCost.toFixed(6)),
              fetch_url_calls: tool_invocations?.fetch_url ?? 0,
              fetch_url_cost_usd: parseFloat(fetchUrlCost.toFixed(6)),
            },
            total_cost_usd: parseFloat(totalCost.toFixed(6)),
            pricing_reference: {
              input_per_million_tokens: pricing.input,
              output_per_million_tokens: pricing.output,
            },
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleListModels(_args: unknown): Promise<ToolResult> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            models: MODEL_CATALOG,
            note: "Prices are in USD per million tokens. Check https://www.perplexity.ai/pricing for the latest.",
            last_updated: "2026-04",
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleHealthCheck(_args: unknown): Promise<ToolResult> {
  const startMs = Date.now();

  const result = await perplexityClient.post("/v1/sonar", {
    model: "sonar",
    messages: [{ role: "user", content: "Reply with 'ok'" }],
    max_tokens: 5,
    stream: false,
  });

  const latencyMs = Date.now() - startMs;

  if (isApiError(result)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              status: "unhealthy",
              error: result.message,
              http_status: result.status,
              latency_ms: latencyMs,
              rateLimit: result.rateLimit,
              diagnosis:
                result.status === 401
                  ? "Invalid or expired API key. Check PERPLEXITY_API_KEY."
                  : result.status === 429
                  ? "Rate limit exceeded. Check rateLimit.reset for when to retry."
                  : result.status === 0
                  ? "Network connectivity issue — cannot reach api.perplexity.ai."
                  : "Unexpected error from Perplexity API.",
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const data = result.data as Record<string, unknown>;
  const model = typeof data["model"] === "string" ? data["model"] : "unknown";

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            status: "healthy",
            latency_ms: latencyMs,
            http_status: result.status,
            model_responded: model,
            rateLimit: result.rateLimit,
            usage: result.usage,
          },
          null,
          2
        ),
      },
    ],
  };
}
