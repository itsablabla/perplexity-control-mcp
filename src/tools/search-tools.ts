import { z } from "zod";
import { perplexityClient, formatResponse } from "../services/perplexity-client.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const WebSearchSchema = z.object({
  query: z
    .union([z.string(), z.array(z.string()).max(5)])
    .describe("Search query string or array of queries (up to 5)."),
  max_results: z.number().int().min(1).max(20).optional().default(5).describe("Max results per query (1-20)."),
  max_tokens: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .optional()
    .describe("Max tokens across all results (up to 1M)."),
  max_tokens_per_page: z
    .number()
    .int()
    .positive()
    .optional()
    .default(4096)
    .describe("Max tokens per individual page (default 4096)."),
  search_domain_filter: z
    .array(z.string())
    .max(20)
    .optional()
    .describe("Up to 20 domains to include/exclude. Prefix with '-' to exclude."),
  search_language_filter: z
    .array(z.string())
    .max(10)
    .optional()
    .describe("Up to 10 BCP 47 language tags to filter by, e.g. ['en', 'fr']."),
  search_recency_filter: z
    .enum(["day", "week", "month", "year"])
    .optional()
    .describe("Restrict results by recency."),
  search_after_date_filter: z.string().optional().describe("Only include results after this date (ISO 8601)."),
  search_before_date_filter: z.string().optional().describe("Only include results before this date (ISO 8601)."),
  last_updated_after_filter: z.string().optional().describe("Only include pages updated after this date (ISO 8601)."),
  last_updated_before_filter: z
    .string()
    .optional()
    .describe("Only include pages updated before this date (ISO 8601)."),
  country: z.string().optional().describe("ISO 3166-1 alpha-2 country code for localized results, e.g. 'US'."),
  search_mode: z
    .enum(["academic", "sec"])
    .optional()
    .describe("Specialized search mode: 'academic' for scholarly papers, 'sec' for SEC filings."),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const searchToolDefinitions = [
  {
    name: "web_search",
    description:
      "Perform a raw web search returning full page content (POST /search). " +
      "Returns structured result objects with URL, title, and text content. " +
      "Supports up to 5 parallel queries, domain filters, date filters, and specialized academic/SEC modes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          description: "Search query string or array of up to 5 query strings.",
        },
        max_results: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 5,
          description: "Maximum number of results per query (1-20).",
        },
        max_tokens: {
          type: "integer",
          minimum: 1,
          maximum: 1000000,
          description: "Maximum total tokens across all results.",
        },
        max_tokens_per_page: {
          type: "integer",
          default: 4096,
          description: "Maximum tokens per individual page (default 4096).",
        },
        search_domain_filter: {
          type: "array",
          items: { type: "string" },
          maxItems: 20,
          description: "Up to 20 domains. Prefix with '-' to exclude, e.g. '-reddit.com'.",
        },
        search_language_filter: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "Up to 10 BCP 47 language tags, e.g. ['en', 'fr'].",
        },
        search_recency_filter: {
          type: "string",
          enum: ["day", "week", "month", "year"],
          description: "Restrict results by recency.",
        },
        search_after_date_filter: {
          type: "string",
          description: "Only include content published after this ISO 8601 date.",
        },
        search_before_date_filter: {
          type: "string",
          description: "Only include content published before this ISO 8601 date.",
        },
        last_updated_after_filter: {
          type: "string",
          description: "Only include pages last updated after this ISO 8601 date.",
        },
        last_updated_before_filter: {
          type: "string",
          description: "Only include pages last updated before this ISO 8601 date.",
        },
        country: {
          type: "string",
          description: "ISO 3166-1 alpha-2 country code for localized results.",
        },
        search_mode: {
          type: "string",
          enum: ["academic", "sec"],
          description: "Specialized search mode: 'academic' for scholarly papers, 'sec' for SEC filings.",
        },
      },
      required: ["query"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }> };

export async function handleWebSearch(args: unknown): Promise<ToolResult> {
  const parsed = WebSearchSchema.safeParse(args);
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

  // Build request body
  const body: Record<string, unknown> = {
    query: params.query,
    max_results: params.max_results,
  };

  if (params.max_tokens !== undefined) body["max_tokens"] = params.max_tokens;
  if (params.max_tokens_per_page !== undefined) body["max_tokens_per_page"] = params.max_tokens_per_page;
  if (params.search_domain_filter !== undefined) body["search_domain_filter"] = params.search_domain_filter;
  if (params.search_language_filter !== undefined) body["search_language_filter"] = params.search_language_filter;
  if (params.search_recency_filter !== undefined) body["search_recency_filter"] = params.search_recency_filter;
  if (params.search_after_date_filter !== undefined) body["search_after_date_filter"] = params.search_after_date_filter;
  if (params.search_before_date_filter !== undefined) body["search_before_date_filter"] = params.search_before_date_filter;
  if (params.last_updated_after_filter !== undefined) body["last_updated_after_filter"] = params.last_updated_after_filter;
  if (params.last_updated_before_filter !== undefined) body["last_updated_before_filter"] = params.last_updated_before_filter;
  if (params.country !== undefined) body["country"] = params.country;
  if (params.search_mode !== undefined) body["search_mode"] = params.search_mode;

  const result = await perplexityClient.post("/search", body);
  return { content: [{ type: "text", text: formatResponse(result) }] };
}
