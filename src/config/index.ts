import { z } from "zod";
import "dotenv/config";

const ConfigSchema = z.object({
  // API key is optional at startup — tools will return an error if called without it
  PERPLEXITY_API_KEY: z.string().optional().default(""),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_PORT: z.coerce.number().int().positive().default(3001),
});

function loadConfig() {
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration error:\n${issues}`);
  }
  const cfg = result.data;
  if (!cfg.PERPLEXITY_API_KEY) {
    console.warn(
      "[perplexity-control-mcp] WARNING: PERPLEXITY_API_KEY is not set. " +
        "Server will start but all API calls will fail until the key is configured."
    );
  }
  return cfg;
}

export const config = loadConfig();

export type Config = z.infer<typeof ConfigSchema>;
