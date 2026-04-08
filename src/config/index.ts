import { z } from "zod";
import "dotenv/config";

const ConfigSchema = z.object({
  PERPLEXITY_API_KEY: z.string().min(1, "PERPLEXITY_API_KEY is required"),
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
  return result.data;
}

export const config = loadConfig();

export type Config = z.infer<typeof ConfigSchema>;
