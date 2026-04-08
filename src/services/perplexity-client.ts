import { config } from "../config/index.js";

export interface RateLimitInfo {
  remaining: number | null;
  reset: number | null;
  limit: number | null;
}

export interface UsageCost {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  citationsCount?: number;
}

export interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  rateLimit: RateLimitInfo;
  usage?: UsageCost;
}

export interface ApiError {
  error: true;
  status: number;
  message: string;
  details?: unknown;
  rateLimit?: RateLimitInfo;
}

// Pricing per million tokens (input/output) in USD
// Source: Perplexity pricing page as of 2025
const MODEL_PRICING: Record<string, { input: number; output: number; perRequest?: number }> = {
  // Sonar models
  "sonar": { input: 1.0, output: 1.0, perRequest: 0.005 },
  "sonar-pro": { input: 3.0, output: 15.0, perRequest: 0.005 },
  "sonar-reasoning": { input: 1.0, output: 5.0, perRequest: 0.005 },
  "sonar-reasoning-pro": { input: 2.0, output: 8.0, perRequest: 0.005 },
  "sonar-deep-research": { input: 2.0, output: 8.0, perRequest: 0.005 },
  // r+ models
  "r-7b-online": { input: 0.2, output: 0.2, perRequest: 0.005 },
  // Embedding models (per-million-token pricing from docs)
  "pplx-embed-v1-0.6b": { input: 0.004, output: 0 },
  "pplx-embed-v1-4b": { input: 0.03, output: 0 },
  "pplx-embed-context-v1-0.6b": { input: 0.008, output: 0 },
  "pplx-embed-context-v1-4b": { input: 0.05, output: 0 },
};

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  const remaining = headers.get("X-RateLimit-Remaining");
  const reset = headers.get("X-RateLimit-Reset");
  const limit = headers.get("X-RateLimit-Limit");
  return {
    remaining: remaining !== null ? parseInt(remaining, 10) : null,
    reset: reset !== null ? parseInt(reset, 10) : null,
    limit: limit !== null ? parseInt(limit, 10) : null,
  };
}

function calculateCost(
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
): UsageCost {
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? (inputTokens + outputTokens);

  const pricing = MODEL_PRICING[model];
  let estimatedCostUsd: number | null = null;
  if (pricing) {
    estimatedCostUsd =
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output;
  }

  return { inputTokens, outputTokens, totalTokens, estimatedCostUsd };
}

async function request<T = unknown>(
  path: string,
  options: RequestInit & { baseUrl?: string } = {}
): Promise<ApiResponse<T> | ApiError> {
  const baseUrl = options.baseUrl ?? "https://api.perplexity.ai";
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${config.PERPLEXITY_API_KEY}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  if (process.env.NODE_ENV !== "test") {
    console.error(`[perplexity-client] ${options.method ?? "GET"} ${url}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err) {
    return {
      error: true,
      status: 0,
      message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rateLimit = parseRateLimitHeaders(response.headers);

  let body: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await response.json();
    } catch {
      body = null;
    }
  } else {
    body = await response.text();
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error: unknown }).error)
        : typeof body === "string"
        ? body
        : `HTTP ${response.status}`;
    return {
      error: true,
      status: response.status,
      message,
      details: body,
      rateLimit,
    };
  }

  // Extract usage + cost if present
  let usage: UsageCost | undefined;
  if (
    typeof body === "object" &&
    body !== null &&
    "usage" in body &&
    typeof (body as { usage: unknown }).usage === "object"
  ) {
    const rawUsage = (body as { usage: Record<string, number>; model?: string }).usage;
    const model = (body as { model?: string }).model ?? "";
    usage = calculateCost(model, rawUsage);
    // Add citations count if available
    if ("num_search_results" in rawUsage) {
      usage.citationsCount = rawUsage["num_search_results"] as number;
    }
  }

  return {
    data: body as T,
    status: response.status,
    rateLimit,
    usage,
  };
}

export const perplexityClient = {
  get<T = unknown>(path: string, baseUrl?: string): Promise<ApiResponse<T> | ApiError> {
    return request<T>(path, { method: "GET", baseUrl });
  },

  post<T = unknown>(path: string, body: unknown, baseUrl?: string): Promise<ApiResponse<T> | ApiError> {
    return request<T>(path, {
      method: "POST",
      body: JSON.stringify(body),
      baseUrl,
    });
  },
};

export function isApiError(r: ApiResponse | ApiError): r is ApiError {
  return "error" in r && r.error === true;
}

export function formatResponse(result: ApiResponse | ApiError): string {
  if (isApiError(result)) {
    const rateLimitStr =
      result.rateLimit
        ? `\nRate limit remaining: ${result.rateLimit.remaining ?? "unknown"}`
        : "";
    return JSON.stringify({
      error: true,
      status: result.status,
      message: result.message,
      details: result.details,
      rateLimit: result.rateLimit,
    }, null, 2);
  }

  return JSON.stringify({
    data: result.data,
    rateLimit: result.rateLimit,
    ...(result.usage ? { usage: result.usage } : {}),
  }, null, 2);
}

export { MODEL_PRICING };
