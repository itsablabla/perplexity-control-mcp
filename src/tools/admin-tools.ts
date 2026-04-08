import { z } from "zod";
import { perplexityClient, formatResponse, isApiError } from "../services/perplexity-client.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const ApiKeyGenerateSchema = z.object({
  token_name: z.string().optional().describe("Optional human-readable name for the new API key."),
});

const ApiKeyRevokeSchema = z.object({
  auth_token: z.string().min(1).describe("The API key (auth token) to revoke."),
});

const ApiKeyRotateSchema = z.object({
  token_name: z
    .string()
    .optional()
    .describe("Optional name for the newly generated API key. The current key will be revoked after rotation."),
});

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const adminToolDefinitions = [
  {
    name: "api_key_generate",
    description:
      "Generate a new Perplexity API key (POST /generate_auth_token). " +
      "Returns the new auth_token, creation timestamp, and optional token_name. " +
      "Note: This uses the PERPLEXITY_API_KEY set in your environment to authenticate.",
    inputSchema: {
      type: "object" as const,
      properties: {
        token_name: {
          type: "string",
          description: "Optional human-readable name for the new API key.",
        },
      },
    },
  },
  {
    name: "api_key_revoke",
    description:
      "Revoke an existing Perplexity API key (POST /revoke_auth_token). " +
      "The revoked key will immediately stop working. This action is irreversible.",
    inputSchema: {
      type: "object" as const,
      properties: {
        auth_token: {
          type: "string",
          description: "The API key (auth_token) to revoke.",
        },
      },
      required: ["auth_token"],
    },
  },
  {
    name: "api_key_rotate",
    description:
      "Rotate the current API key: generates a new key, verifies it works by making a test request, " +
      "then revokes the old key. Returns the new key and rotation status. " +
      "IMPORTANT: Save the new key immediately — it will not be shown again.",
    inputSchema: {
      type: "object" as const,
      properties: {
        token_name: {
          type: "string",
          description: "Optional name for the newly generated API key.",
        },
      },
    },
  },
] as const;

// ─── Tool Handlers ─────────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }> };

export async function handleApiKeyGenerate(args: unknown): Promise<ToolResult> {
  const parsed = ApiKeyGenerateSchema.safeParse(args);
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

  const body: Record<string, unknown> = {};
  if (parsed.data.token_name !== undefined) body["token_name"] = parsed.data.token_name;

  const result = await perplexityClient.post("/generate_auth_token", body);
  return { content: [{ type: "text", text: formatResponse(result) }] };
}

export async function handleApiKeyRevoke(args: unknown): Promise<ToolResult> {
  const parsed = ApiKeyRevokeSchema.safeParse(args);
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

  const result = await perplexityClient.post("/revoke_auth_token", {
    auth_token: parsed.data.auth_token,
  });
  return { content: [{ type: "text", text: formatResponse(result) }] };
}

export async function handleApiKeyRotate(args: unknown): Promise<ToolResult> {
  const parsed = ApiKeyRotateSchema.safeParse(args);
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

  // Step 1: Generate new key
  const generateBody: Record<string, unknown> = {};
  if (parsed.data.token_name !== undefined) generateBody["token_name"] = parsed.data.token_name;

  const generateResult = await perplexityClient.post("/generate_auth_token", generateBody);
  if (isApiError(generateResult)) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "Failed to generate new API key",
              details: {
                status: generateResult.status,
                message: generateResult.message,
              },
              old_key_revoked: false,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  const newToken = (generateResult.data as { auth_token?: string })?.auth_token;
  if (!newToken) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              error: "New key generation succeeded but auth_token was not returned",
              raw_response: generateResult.data,
              old_key_revoked: false,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Step 2: Verify the new key works by making a minimal test request
  let newKeyWorks = false;
  let testError: string | null = null;
  try {
    const testResponse = await fetch("https://api.perplexity.ai/v1/sonar", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${newToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    newKeyWorks = testResponse.ok || testResponse.status === 400; // 400 is fine — key works
  } catch (err) {
    testError = err instanceof Error ? err.message : String(err);
  }

  if (!newKeyWorks) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              warning: "New key was generated but test request failed — old key NOT revoked for safety.",
              new_key: newToken,
              new_key_data: generateResult.data,
              test_error: testError,
              old_key_revoked: false,
            },
            null,
            2
          ),
        },
      ],
    };
  }

  // Step 3: Record old key from env, then revoke it
  const { config } = await import("../config/index.js");
  const oldKey = config.PERPLEXITY_API_KEY;
  let oldKeyRevoked = false;
  let revokeError: string | null = null;

  const revokeResult = await perplexityClient.post("/revoke_auth_token", { auth_token: oldKey });
  if (isApiError(revokeResult)) {
    revokeError = revokeResult.message;
  } else {
    oldKeyRevoked = true;
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            success: true,
            new_key: newToken,
            new_key_data: generateResult.data,
            old_key_revoked: oldKeyRevoked,
            revoke_error: revokeError,
            note: oldKeyRevoked
              ? "Rotation complete. Update PERPLEXITY_API_KEY in your environment immediately."
              : `Rotation incomplete: new key generated but old key revocation failed: ${revokeError}`,
          },
          null,
          2
        ),
      },
    ],
  };
}
