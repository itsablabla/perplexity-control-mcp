#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { config } from "./config/index.js";
import { registerAllTools } from "./tools/index.js";

// ─── Server factory ────────────────────────────────────────────────────────────

function createMcpServer(): Server {
  const server = new Server(
    {
      name: "@garza-os/perplexity-control-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  registerAllTools(server);

  server.onerror = (err) => {
    console.error("[MCP server error]", err);
  };

  return server;
}

// ─── Stdio transport ───────────────────────────────────────────────────────────

async function startStdio(): Promise<void> {
  console.error("[perplexity-control-mcp] Starting stdio transport...");
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[perplexity-control-mcp] Stdio transport connected. Awaiting MCP messages.");
}

// ─── HTTP (Streamable-HTTP) transport ─────────────────────────────────────────

async function startHttp(): Promise<void> {
  const port = config.MCP_PORT;
  console.error(`[perplexity-control-mcp] Starting HTTP transport on port ${port}...`);

  // Session map: sessionId -> { server, transport }
  const sessions = new Map<
    string,
    { server: Server; transport: StreamableHTTPServerTransport }
  >();

  const httpServer = createHttpServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      // Health endpoint
      if (url.pathname === "/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", transport: "http", port }));
        return;
      }

      // Only /mcp endpoint
      if (url.pathname !== "/mcp") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found. Use POST /mcp" }));
        return;
      }

      if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      // Read body for POST
      let body = "";
      if (req.method === "POST") {
        for await (const chunk of req) {
          body += chunk;
        }
      }

      // Parse session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      // Determine if this is an init request
      let parsedBody: unknown;
      try {
        parsedBody = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      const isInit = parsedBody !== undefined && isInitializeRequest(parsedBody);

      if (isInit || !sessionId) {
        // New session
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            sessions.set(sid, { server, transport });
            console.error(`[perplexity-control-mcp] HTTP session created: ${sid}`);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            console.error(`[perplexity-control-mcp] HTTP session closed: ${transport.sessionId}`);
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, parsedBody);
        return;
      }

      // Existing session
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Session '${sessionId}' not found` }));
        return;
      }

      await session.transport.handleRequest(req, res, parsedBody);
    }
  );

  httpServer.on("error", (err) => {
    console.error("[perplexity-control-mcp] HTTP server error:", err);
    process.exit(1);
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));
  console.error(`[perplexity-control-mcp] HTTP MCP server listening on http://localhost:${port}/mcp`);
  console.error(`[perplexity-control-mcp] Health check: http://localhost:${port}/health`);
}

// ─── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    if (config.MCP_TRANSPORT === "http") {
      await startHttp();
    } else {
      await startStdio();
    }
  } catch (err) {
    console.error("[perplexity-control-mcp] Fatal startup error:", err);
    process.exit(1);
  }
}

main();
