import { z } from "zod";
import { perplexityClient, formatResponse } from "../services/perplexity-client.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const EmbeddingModelSchema = z.enum(["pplx-embed-v1-0.6b", "pplx-embed-v1-4b"]);
const ContextEmbeddingModelSchema = z.enum(["pplx-embed-context-v1-0.6b", "pplx-embed-context-v1-4b"]);
const EncodingFormatSchema = z.enum(["base64_int8", "base64_binary"]);

const EmbeddingsCreateSchema = z.object({
  input: z
    .union([z.string(), z.array(z.string())])
    .describe("Text string or array of text strings to embed."),
  model: EmbeddingModelSchema.default("pplx-embed-v1-0.6b").describe("Embedding model to use."),
  dimensions: z
    .number()
    .int()
    .min(128)
    .max(2560)
    .optional()
    .describe("Output vector dimensions (128-2560). Defaults to model's native size."),
  encoding_format: EncodingFormatSchema.optional().describe(
    "Encoding format for the returned vectors. Defaults to base64_int8."
  ),
});

const EmbeddingsContextualizedSchema = z.object({
  input: z
    .array(z.array(z.string()))
    .min(1)
    .describe(
      "Array of arrays of text chunks, grouped by document. " +
        "Each inner array represents one document's chunks. " +
        "The model uses surrounding chunks (context) to produce better embeddings."
    ),
  model: ContextEmbeddingModelSchema.default("pplx-embed-context-v1-0.6b").describe(
    "Contextualized embedding model to use."
  ),
  dimensions: z
    .number()
    .int()
    .min(128)
    .max(2560)
    .optional()
    .describe("Output vector dimensions (128-2560)."),
  encoding_format: EncodingFormatSchema.optional(),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const embeddingsToolDefinitions = [
  {
    name: "embeddings_create",
    description:
      "Generate dense vector embeddings for one or more text strings (POST /v1/embeddings). " +
      "Use for semantic search, similarity comparison, or retrieval-augmented generation (RAG). " +
      "Returns vectors in base64 format.",
    inputSchema: {
      type: "object" as const,
      properties: {
        input: {
          description: "Text string or array of strings to embed.",
        },
        model: {
          type: "string",
          enum: ["pplx-embed-v1-0.6b", "pplx-embed-v1-4b"],
          default: "pplx-embed-v1-0.6b",
          description:
            "Embedding model. '0.6b' is faster and cheaper; '4b' produces higher quality vectors.",
        },
        dimensions: {
          type: "integer",
          minimum: 128,
          maximum: 2560,
          description: "Output vector dimensions (128-2560). Defaults to model's native dimensionality.",
        },
        encoding_format: {
          type: "string",
          enum: ["base64_int8", "base64_binary"],
          description: "Encoding format for the returned embedding vectors.",
        },
      },
      required: ["input"],
    },
  },
  {
    name: "embeddings_contextualized",
    description:
      "Generate context-aware embeddings for document chunks (POST /v1/contextualizedembeddings). " +
      "Unlike standard embeddings, each chunk's vector is influenced by surrounding chunks in the same document, " +
      "producing better representations for RAG. " +
      "Input is an array of arrays: each inner array is a document's chunks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        input: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
          description:
            "Array of documents, each being an array of text chunks. " +
            "Example: [['chunk1 of doc1', 'chunk2 of doc1'], ['chunk1 of doc2']]",
        },
        model: {
          type: "string",
          enum: ["pplx-embed-context-v1-0.6b", "pplx-embed-context-v1-4b"],
          default: "pplx-embed-context-v1-0.6b",
          description: "Contextualized embedding model.",
        },
        dimensions: {
          type: "integer",
          minimum: 128,
          maximum: 2560,
          description: "Output vector dimensions (128-2560).",
        },
        encoding_format: {
          type: "string",
          enum: ["base64_int8", "base64_binary"],
          description: "Encoding format for the returned embedding vectors.",
        },
      },
      required: ["input"],
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }> };

export async function handleEmbeddingsCreate(args: unknown): Promise<ToolResult> {
  const parsed = EmbeddingsCreateSchema.safeParse(args);
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
  const body: Record<string, unknown> = {
    input: params.input,
    model: params.model,
  };
  if (params.dimensions !== undefined) body["dimensions"] = params.dimensions;
  if (params.encoding_format !== undefined) body["encoding_format"] = params.encoding_format;

  const result = await perplexityClient.post("/v1/embeddings", body);
  return { content: [{ type: "text", text: formatResponse(result) }] };
}

export async function handleEmbeddingsContextualized(args: unknown): Promise<ToolResult> {
  const parsed = EmbeddingsContextualizedSchema.safeParse(args);
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
  const body: Record<string, unknown> = {
    input: params.input,
    model: params.model,
  };
  if (params.dimensions !== undefined) body["dimensions"] = params.dimensions;
  if (params.encoding_format !== undefined) body["encoding_format"] = params.encoding_format;

  const result = await perplexityClient.post("/v1/contextualizedembeddings", body);
  return { content: [{ type: "text", text: formatResponse(result) }] };
}
