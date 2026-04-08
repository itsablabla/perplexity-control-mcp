# @garza-os/perplexity-control-mcp

A comprehensive MCP (Model Context Protocol) server that provides **full programmatic control** over the Perplexity API platform. Unlike the official Perplexity MCP server (which only exposes `search`, `ask`, `research`, and `reason`), this server is a complete control plane.

## Why this exists

The official Perplexity MCP server wraps only the Sonar chat endpoint and hides the underlying API. This server exposes every Perplexity API surface:

| Capability | Official MCP | This server |
|---|---|---|
| Sonar chat completions | ✅ (as `ask`) | ✅ `sonar_chat` |
| Deep research | ✅ (as `research`) | ✅ `sonar_chat` + `sonar_async_*` |
| Agent API | ❌ | ✅ `agent_create` |
| Raw web search | ❌ | ✅ `web_search` |
| Async jobs | ❌ | ✅ `sonar_async_submit/get/list` |
| Embeddings | ❌ | ✅ `embeddings_create` |
| Contextualized embeddings | ❌ | ✅ `embeddings_contextualized` |
| API key management | ❌ | ✅ `api_key_generate/revoke/rotate` |
| Cost estimation | ❌ | ✅ `estimate_cost` |
| Model catalog | ❌ | ✅ `list_models` |
| Health check | ❌ | ✅ `health_check` |
| HTTP transport | ❌ | ✅ Streamable HTTP |
| Full parameter control | ❌ | ✅ All API params exposed |

---

## Installation

```bash
git clone <repo>
cd perplexity-control-mcp
npm install
cp .env.example .env
# Edit .env and set PERPLEXITY_API_KEY
npm run build
```

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PERPLEXITY_API_KEY` | *(required)* | Your Perplexity API key |
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` | `3001` | HTTP port (only for `http` transport) |

---

## MCP Client Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "perplexity-control": {
      "command": "node",
      "args": ["/absolute/path/to/perplexity-control-mcp/dist/index.js"],
      "env": {
        "PERPLEXITY_API_KEY": "pplx-your-key-here"
      }
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "perplexity-control": {
      "command": "node",
      "args": ["/absolute/path/to/perplexity-control-mcp/dist/index.js"],
      "env": {
        "PERPLEXITY_API_KEY": "pplx-your-key-here"
      }
    }
  }
}
```

### Comet (HTTP transport)

Start the server in HTTP mode:

```bash
MCP_TRANSPORT=http MCP_PORT=3001 PERPLEXITY_API_KEY=pplx-... npm start
```

Then configure Comet to use `http://localhost:3001/mcp`.

### npx (without cloning)

After publishing to npm:

```json
{
  "mcpServers": {
    "perplexity-control": {
      "command": "npx",
      "args": ["-y", "@garza-os/perplexity-control-mcp"],
      "env": {
        "PERPLEXITY_API_KEY": "pplx-your-key-here"
      }
    }
  }
}
```

---

## All Tools

### Agent API

#### `agent_create`
Create an agent response using the Perplexity Agent API (`POST /v1/agent`). Supports multi-step agentic reasoning with tool use.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `input` | string \| message[] | ✅ | User input (string or messages array) |
| `model` | string | * | Provider/model format, e.g. `openai/gpt-5.4` |
| `models` | string[] | * | Fallback model chain (max 5). Overrides `model` |
| `preset` | enum | * | `fast-search`, `pro-search`, `deep-research`, `advanced-deep-research` |
| `instructions` | string | | System instructions |
| `tools` | array | | `web_search`, `fetch_url`, or `function` tools |
| `max_output_tokens` | integer | | Maximum response tokens |
| `max_steps` | integer (1-10) | | Maximum agentic steps |
| `reasoning` | object | | `{effort: "low"|"medium"|"high"}` |
| `response_format` | object | | Structured output: `{type: "json_object"}` etc |
| `language_preference` | string | | ISO 639-1 code, e.g. `"en"` |

*One of `model`, `models`, or `preset` is required.

---

### Sonar API

#### `sonar_chat`
Chat completions with live web grounding (`POST /v1/sonar`).

| Parameter | Type | Description |
|---|---|---|
| `model` | enum | `sonar`, `sonar-pro`, `sonar-reasoning`, `sonar-reasoning-pro`, `sonar-deep-research` |
| `messages` | message[] | Conversation messages with `role` and `content` |
| `max_tokens` | integer | Max response tokens |
| `temperature` | float (0-2) | Sampling temperature |
| `top_p` | float (0-1) | Nucleus sampling probability |
| `search_domain_filter` | string[] | Whitelist/blacklist domains (prefix `-` to exclude) |
| `search_recency_filter` | enum | `day`, `week`, `month`, `year` |
| `return_images` | boolean | Include image results |
| `search_after_date_filter` | string | ISO 8601 date |
| `search_before_date_filter` | string | ISO 8601 date |
| `user_location` | object | `{country, city, region, timezone}` |
| `search_language_filter` | string | BCP 47 language tag |

#### `sonar_async_submit`
Submit an async deep research job (`POST /v1/async/sonar`). Same parameters as `sonar_chat`. Returns a `request_id`.

#### `sonar_async_get`
Poll an async job (`GET /v1/async/sonar/{request_id}`).

| Parameter | Type | Description |
|---|---|---|
| `request_id` | string | ID from `sonar_async_submit` |

#### `sonar_async_list`
List all async jobs (`GET /v1/async/sonar`). No parameters.

---

### Search API

#### `web_search`
Raw web search returning full page content (`POST /search`).

| Parameter | Type | Description |
|---|---|---|
| `query` | string \| string[] | Query or up to 5 queries |
| `max_results` | integer (1-20) | Results per query (default 5) |
| `max_tokens` | integer (≤1M) | Total token budget |
| `max_tokens_per_page` | integer | Per-page token limit (default 4096) |
| `search_domain_filter` | string[] (≤20) | Domain include/exclude list |
| `search_language_filter` | string[] (≤10) | BCP 47 language filter |
| `search_recency_filter` | enum | `day`, `week`, `month`, `year` |
| `search_after_date_filter` | string | ISO 8601 date |
| `search_before_date_filter` | string | ISO 8601 date |
| `last_updated_after_filter` | string | ISO 8601 date |
| `last_updated_before_filter` | string | ISO 8601 date |
| `country` | string | ISO 3166-1 alpha-2 country code |
| `search_mode` | enum | `academic` or `sec` |

---

### Embeddings API

#### `embeddings_create`
Generate dense vector embeddings (`POST /v1/embeddings`).

| Parameter | Type | Description |
|---|---|---|
| `input` | string \| string[] | Text to embed |
| `model` | enum | `pplx-embed-v1-0.6b`, `pplx-embed-v1-4b` |
| `dimensions` | integer (128-2560) | Output vector dimensions |
| `encoding_format` | enum | `base64_int8`, `base64_binary` |

#### `embeddings_contextualized`
Document-aware embeddings where each chunk's vector is influenced by surrounding context (`POST /v1/contextualizedembeddings`).

| Parameter | Type | Description |
|---|---|---|
| `input` | string[][] | Array of documents, each being an array of chunks |
| `model` | enum | `pplx-embed-context-v1-0.6b`, `pplx-embed-context-v1-4b` |
| `dimensions` | integer (128-2560) | Output vector dimensions |
| `encoding_format` | enum | `base64_int8`, `base64_binary` |

---

### API Key Management

#### `api_key_generate`
Generate a new API key (`POST /generate_auth_token`).

| Parameter | Type | Description |
|---|---|---|
| `token_name` | string | Optional label for the key |

Returns: `{ auth_token, created_at_epoch_seconds, token_name }`

#### `api_key_revoke`
Revoke an API key (`POST /revoke_auth_token`). **Irreversible.**

| Parameter | Type | Description |
|---|---|---|
| `auth_token` | string | The key to revoke |

#### `api_key_rotate`
Convenience: generates a new key, tests it, then revokes the current key.

| Parameter | Type | Description |
|---|---|---|
| `token_name` | string | Optional label for the new key |

Returns: `{ new_key, old_key_revoked, note }`
**Save the `new_key` immediately and update `PERPLEXITY_API_KEY` in your environment.**

---

### Utility Tools

#### `estimate_cost`
Calculate estimated USD cost before sending a request.

| Parameter | Type | Description |
|---|---|---|
| `model` | string | Model ID |
| `input_tokens` | integer | Input token count |
| `output_tokens` | integer | Output token count |
| `tool_invocations` | object | `{web_search: N, fetch_url: N}` |

#### `list_models`
Returns the full model catalog with descriptions, context lengths, and pricing.

#### `health_check`
Verifies API connectivity and key validity. Makes a minimal test request and returns latency and rate limit information.

---

## Architecture

```
perplexity-control-mcp/
├── src/
│   ├── index.ts              # Entry point — stdio or HTTP transport
│   ├── config/
│   │   └── index.ts          # Env var validation (Zod)
│   ├── services/
│   │   └── perplexity-client.ts  # Centralized HTTP client
│   └── tools/
│       ├── index.ts          # Tool registry + request routing
│       ├── agent-tools.ts    # agent_create
│       ├── sonar-tools.ts    # sonar_chat, sonar_async_*
│       ├── search-tools.ts   # web_search
│       ├── embeddings-tools.ts   # embeddings_create, embeddings_contextualized
│       ├── admin-tools.ts    # api_key_generate/revoke/rotate
│       └── utility-tools.ts  # estimate_cost, list_models, health_check
├── .env.example
├── package.json
└── tsconfig.json
```

### Client features
- Automatic `Authorization: Bearer` token injection
- Structured error responses with HTTP status codes
- Rate limit header parsing (`X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Limit`)
- Automatic cost calculation from response `usage` objects
- Request logging to stderr

### Transport
- **stdio** (default): Pipe-based transport for local MCP clients
- **http**: Stateful Streamable HTTP transport with per-session server instances. Each session gets its own `Server` instance. Sessions are cleaned up on disconnect.

---

## Development

```bash
# Watch mode
npm run dev

# Build
npm run build

# Run (stdio)
PERPLEXITY_API_KEY=pplx-... npm start

# Run (HTTP)
MCP_TRANSPORT=http PERPLEXITY_API_KEY=pplx-... npm start
```

---

## License

MIT
