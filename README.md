# SharedBrain

**Local-first, multi-user shared memory for AI agents.**

SharedBrain is an MCP server that gives AI agents persistent memory with semantic search. It works offline, syncs across devices and teams, and never phones home. Embeddings are computed locally via ONNX — no API keys required.

```
You: "Remember that we decided to use PostgreSQL for the relay server"
Agent: *stores memory with type=decision, computes embedding locally*

Later...
You: "What database are we using for sync?"
Agent: *semantic search finds the decision with 94% similarity*
```

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/anthropics/shared-brain.git
cd shared-brain
pnpm install

# 2. Initialize
pnpm --filter @shared-brain/cli dev -- init

# 3. Start the MCP server
pnpm --filter @shared-brain/server dev
```

The server starts at `http://127.0.0.1:3100/mcp`. Your auth token is printed during init.

---

## MCP Client Configuration

### Claude Code

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "shared-brain": {
      "type": "streamable-http",
      "url": "http://127.0.0.1:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "shared-brain": {
      "url": "http://127.0.0.1:3100/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

### VS Code (Copilot)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "shared-brain": {
      "type": "http",
      "url": "http://127.0.0.1:3100/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MCP Clients                                  │
│  (Claude Code, Cursor, VS Code, custom agents)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Streamable HTTP
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     @shared-brain/server                             │
│  MCP Tools: memory_store, memory_search, memory_get, memory_update  │
│  MCP Resources: stats, recent, tags                                 │
│  Auth: Bearer token / OAuth2                                        │
└──────────────┬──────────────────────────────────┬───────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────────┐        ┌─────────────────────────────────┐
│    @shared-brain/core    │        │       @shared-brain/sync        │
│                          │        │                                 │
│  - SQLite store          │        │  - WebSocket client             │
│  - ONNX embeddings       │        │  - Offline queue                │
│  - CRDT (HLC/LWW/OR-Set)│        │  - Merkle tree diff             │
│  - Vector index          │        │  - Relay server (PostgreSQL)    │
└──────────────────────────┘        └─────────────────────────────────┘
               │                                  │
               ▼                                  ▼
        ┌──────────┐                    ┌──────────────────┐
        │  SQLite  │                    │ Relay (WebSocket) │
        │  (local) │                    │  + PostgreSQL     │
        └──────────┘                    └──────────────────┘
```

### Key Design Choices

| Feature | Implementation | Why |
|---------|---------------|-----|
| Local-first | SQLite + in-process | Works offline, zero config, fast |
| Embeddings | ONNX (all-MiniLM-L6-v2) | No API keys, 384 dims, ~10ms/embed |
| Conflict resolution | Per-field LWW + OR-Set | No data loss on concurrent edits |
| Sync | Merkle tree + op log | O(log n) diff, minimal bandwidth |
| Transport | Streamable HTTP | Multi-client, standard MCP |
| Scope | Personal / Team / Org | Granular visibility control |

---

## CLI Usage

```bash
# Initialize a new instance
shared-brain init

# Store a memory
shared-brain store --content "PostgreSQL 16 with pgvector for vector search" \
  --type decision --tags "database,infrastructure" --title "DB choice"

# Semantic search
shared-brain search "what database do we use"

# Search with filters
shared-brain search "deployment" --type procedure --limit 5 --threshold 0.5

# Check sync status
shared-brain sync status

# Force push/pull
shared-brain sync push
shared-brain sync pull
```

---

## Docker Compose (Team Sync)

Start the relay server + PostgreSQL for team synchronization:

```bash
cd docker
docker compose up -d
```

This starts:
- **PostgreSQL** (port 5432) with pgvector extension
- **Relay server** (port 3200) for WebSocket sync

To also start the Adminer DB inspector:

```bash
docker compose --profile debug up -d
# Adminer at http://localhost:8080
```

Then configure your `.env`:

```bash
SYNC_RELAY_URL=ws://localhost:3200
SYNC_AUTH_TOKEN=dev-sync-token
```

---

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `memory_store` | Store a new memory with content, type, scope, tags |
| `memory_search` | Semantic search by meaning (not keywords) |
| `memory_get` | Retrieve a specific memory by ID |
| `memory_update` | Update fields of an existing memory |
| `memory_delete` | Soft-delete a memory |
| `memory_list` | List memories with filters and pagination |
| `memory_relate` | Find semantically related memories |
| `memory_import` | Bulk import from JSON |
| `memory_export` | Export memories as JSON or Markdown |
| `sync_status` | Check sync connection and pending ops |

---

## Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Dev mode (watch + rebuild)
pnpm dev

# Lint
pnpm lint
```

### Project Structure

```
shared-brain/
├── packages/
│   ├── core/       # Data models, CRDT, embeddings, SQLite store
│   ├── server/     # MCP server (Streamable HTTP transport)
│   ├── sync/       # Sync engine (WebSocket client + relay)
│   └── cli/        # Command-line interface
├── docker/         # Docker Compose + Dockerfile for relay
├── models/         # ONNX model cache (auto-downloaded)
└── ARCHITECTURE.md # Detailed technical design
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes with tests
4. Ensure all checks pass: `pnpm build && pnpm test && pnpm lint`
5. Submit a pull request

Please follow:
- **Conventional commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- **TypeScript strict mode**: no `any`, no implicit returns
- **ESM only**: use `.js` extensions in imports
- **Tests**: add tests for new functionality

---

## License

[MIT](./LICENSE)
