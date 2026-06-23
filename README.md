# SharedBrain

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)

**Local-first, multi-user shared memory for AI agents.**

SharedBrain is an MCP server that gives AI agents persistent, searchable memory with zero configuration. It works completely offline, syncs seamlessly across teams, and never sends data to third parties. Embeddings are computed locally via ONNX — no API keys, no cloud dependencies, no tracking.

---

## What is SharedBrain?

SharedBrain is a production-ready memory system for AI agents and teams that need persistent context without cloud lock-in. Unlike hosted services, it runs entirely on your infrastructure with local embeddings, real-time collaboration, and automatic organization. Deploy it once and your entire team gets semantic search, version history, and cross-agent memory sharing.

**Key differentiators:**
- **Zero external dependencies**: ONNX embeddings (384-dim all-MiniLM-L6-v2) run in-process with no API calls
- **Team collaboration built-in**: Personal/team/org scopes, notifications, real-time sync, and audit logs from day one
- **Production-ready**: Rate limiting, JWT auth, health checks, automated backups, monitoring dashboard, and encryption at rest

---

## Features

### Core
- **12 MCP tools** — `memory_store`, `memory_search`, `memory_get`, `memory_update`, `memory_delete`, `memory_list`, `memory_relate`, `memory_import`, `memory_export`, `memory_checkin`, `memory_history`, `sync_status`
- **Hybrid search** — Semantic (HNSW vector index) + keyword (BM25 full-text) with RRF fusion
- **HNSW index** — Fast approximate nearest neighbor search with configurable M/efConstruction
- **Auto-organization** — AI-powered title/tag/relation inference from content
- **Version history** — Full audit trail of edits with diff support

### Collaboration
- **Multi-user** — Personal/team/org memory scopes with fine-grained access control
- **Teams** — Create teams, invite members, manage permissions
- **Notifications** — Real-time alerts for relevant activity from teammates
- **Ownership** — Every memory tracks author, timestamp, and edit history

### Security
- **JWT authentication** — Token-based auth with 30-day expiry and refresh
- **Rate limiting** — Per-endpoint limits (100 req/min MCP, 20 req/min ingest, 10 req/min setup)
- **Audit log** — Every request logged with user, endpoint, params, and result
- **Encryption** — SQLite database with optional at-rest encryption
- **Input sanitization** — All write endpoints scrub XSS/injection attempts

### Operations
- **Monitoring** — Real-time metrics dashboard (`/monitoring`) with request counts, latency, errors, and memory usage
- **Automated backups** — Scheduled database snapshots with retention policies
- **Health checks** — `/health/ready` (liveness), `/health/deep` (full system check), `/health/metrics` (Prometheus format)
- **Versioning** — Per-memory version history with rollback support

### UI
- **SPA dashboard** — Browse, search, and manage memories at `/app`
- **Knowledge graph** — Visual relationship explorer at `/graph`
- **Browse page** — Filter by type/tag/author at `/browse`
- **Analytics** — Team contribution metrics, coverage heatmaps, knowledge graph growth at `/analytics/team`
- **Mobile-ready** — Responsive design works on phones/tablets

---

## Quick Start

**One-liner install:**

```bash
curl -fsSL https://raw.githubusercontent.com/awictor/shared-brain/main/install.sh | bash
```

**Or manually:**

```bash
git clone https://github.com/awictor/shared-brain
cd shared-brain/packages/server
npm install
npm run build
npm start
# → Server running at http://localhost:3100
# → Dashboard at http://localhost:3100/app
```

The server will print your JWT token on first run. Save it for the next step.

---

## Connect Your Agent

### Claude Code

Add to `~/.claude/settings.json`:

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

**Get your token:**
```bash
curl "http://localhost:3100/api/auth/token?userId=your-alias&userName=Your%20Name"
```

### Cursor

Add to `~/.cursor/mcp.json`:

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

### VS Code (GitHub Copilot)

Add to project `.vscode/mcp.json`:

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

### Custom Agents

Use the MCP SDK with Streamable HTTP transport:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHttpClientTransport } from '@modelcontextprotocol/sdk/client/transports.js';

const transport = new StreamableHttpClientTransport(
  'http://127.0.0.1:3100/mcp',
  { Authorization: 'Bearer YOUR_TOKEN_HERE' }
);

const client = new Client({ name: 'my-agent', version: '1.0.0' }, { capabilities: {} });
await client.connect(transport);

// Store a memory
await client.callTool('memory_store', {
  content: 'We decided to use React for the frontend',
  type: 'decision',
  tags: ['frontend', 'architecture']
});

// Search
const results = await client.callTool('memory_search', {
  query: 'what frontend framework',
  limit: 5
});
```

---

## For Teams

1. **Deploy the server** to a shared host (EC2, DigitalOcean, on-prem server)
2. **Start the relay** for real-time sync: `cd docker && docker compose up -d`
3. **Share the join link** with your team: `https://your-server.com/join`
4. **Teammates install** the proxy script to auto-configure their agents:
   ```bash
   curl https://your-server.com/proxy.js > shared-brain-proxy.js
   chmod +x shared-brain-proxy.js
   node shared-brain-proxy.js
   ```

The proxy script:
- Prompts for user alias/name on first run
- Fetches a JWT token from the server
- Saves identity to `~/.shared-brain/identity.json`
- Forwards all MCP requests with auth headers

**Team onboarding flow:**
1. Admin creates a team at `/app` or via API
2. Admin invites members (generates invite links)
3. Members visit `/join?invite=TOKEN` to accept
4. Members' agents automatically sync team memories

---

## Architecture

SharedBrain is a monorepo with four packages:

```
shared-brain/
├── packages/
│   ├── core/       # Data models, CRDT, embeddings, SQLite store
│   ├── server/     # MCP server (Express + Streamable HTTP)
│   ├── sync/       # Sync engine (WebSocket client + relay)
│   └── cli/        # Command-line interface
```

**Data flow:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MCP Clients                                  │
│  (Claude Code, Cursor, VS Code, custom agents)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Streamable HTTP + JWT
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     @shared-brain/server                             │
│  12 MCP Tools | JWT Auth | Rate Limiting | Audit Log | Monitoring   │
└──────────────┬──────────────────────────────────┬───────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────────┐        ┌─────────────────────────────────┐
│    @shared-brain/core    │        │       @shared-brain/sync        │
│                          │        │                                 │
│  - SQLite (sql.js)       │        │  - WebSocket client             │
│  - ONNX embeddings       │        │  - Offline queue                │
│  - HNSW index            │        │  - Merkle tree diff             │
│  - BM25 full-text        │        │  - CRDT merge                   │
│  - CRDT (HLC/LWW)        │        │  - Relay (PostgreSQL + WS)      │
└──────────────────────────┘        └─────────────────────────────────┘
```

**Key design choices:**

| Feature | Implementation | Why |
|---------|---------------|-----|
| **Local-first** | SQLite (sql.js) + in-process | Works offline, zero config, fast reads |
| **Embeddings** | ONNX (all-MiniLM-L6-v2) | No API keys, 384 dims, ~10ms/embed, runs in Node |
| **Vector search** | HNSW index | O(log n) approximate NN, recall > 0.95 |
| **Conflict resolution** | HLC + LWW per-field | Preserves intent, no data loss on concurrent edits |
| **Sync protocol** | Merkle tree + op log | O(log n) diff, minimal bandwidth, eventually consistent |
| **Transport** | Streamable HTTP | Multi-client, standard MCP, SSE for resources |
| **Auth** | JWT (30-day expiry) | Stateless, works with load balancers, mobile-friendly |
| **Scope** | Personal / Team / Org | Granular visibility without complex ACLs |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full technical details.

---

## API Reference

### MCP Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| **`memory_store`** | Store a new memory with content, type, scope, tags | `content`, `type`, `scope`, `tags`, `relations` |
| **`memory_search`** | Hybrid semantic + keyword search (RRF fusion) | `query`, `mode` (semantic/keyword/hybrid), `threshold`, `limit` |
| **`memory_get`** | Retrieve a specific memory by ID | `id` |
| **`memory_update`** | Update fields of an existing memory | `id`, `content`, `title`, `tags.add`, `tags.remove` |
| **`memory_delete`** | Soft-delete a memory (recoverable) | `id` |
| **`memory_list`** | List memories with filters and pagination | `scope`, `filters`, `mine`, `sort`, `limit`, `offset` |
| **`memory_relate`** | Find semantically related memories by vector similarity | `id`, `limit`, `threshold` |
| **`memory_import`** | Bulk import from JSON array | `memories[]`, `scope` |
| **`memory_export`** | Export memories as JSON or Markdown | `scope`, `filters`, `format` (json/markdown) |
| **`memory_checkin`** | Context briefing at conversation start (recent/today/actions/cross-agent) | `limit`, `since` |
| **`memory_history`** | Full version history for a memory with diffs | `id`, `limit` |
| **`sync_status`** | Current sync state (pending ops, connection, last sync) | _(none)_ |

**Memory types:** `fact`, `procedure`, `decision`, `context`, `preference`, `reference`

**Search modes:**
- `semantic` — Embedding-only (best for conceptual queries)
- `keyword` — BM25 only (best for exact terms, names, IDs)
- `hybrid` — RRF fusion of both (default, best overall)

---

## Pages

All pages are served at `http://localhost:3100` by default.

### User-Facing

| Path | Description |
|------|-------------|
| **`/app`** | Unified SPA — search, browse, create, manage memories |
| **`/browse`** | Browse knowledge with filters (type/tag/author/date) |
| **`/graph`** | Interactive knowledge graph (force-directed layout, zoom/pan) |
| **`/join`** | Team onboarding page (accept invites, download proxy script) |
| **`/setup`** | First-run wizard (auto-detect agent, generate config) |
| **`/status`** | System status page (memory count, sync state, uptime) |
| **`/analytics/team`** | Team analytics dashboard (contributions, coverage, growth) |

### API Endpoints

| Path | Method | Description |
|------|--------|-------------|
| **`/mcp`** | POST | MCP protocol endpoint (Streamable HTTP) |
| **`/api/auth/token`** | GET | Issue JWT token (`?userId=X&userName=Y`) |
| **`/api/auth/verify`** | GET | Verify JWT token validity |
| **`/api/users`** | GET | List all users with activity stats |
| **`/api/teams`** | GET/POST | List teams or create a new team |
| **`/api/teams/:id/members`** | GET/POST/DELETE | Manage team membership |
| **`/api/notifications`** | GET | Unread notifications for current user |
| **`/api/notifications/read/:id`** | POST | Mark notification as read |
| **`/api/graph/data`** | GET | Graph data (nodes/edges for visualization) |
| **`/api/metrics`** | GET | Current system metrics (Prometheus format) |
| **`/api/metrics/history`** | GET | Historical metrics (last 24h) |
| **`/api/audit`** | GET | Audit log (filtered by user/endpoint/timeframe) |

### Ingest Webhooks

| Path | Method | Description |
|------|--------|-------------|
| **`/ingest/slack`** | POST | Slack webhook (message → memory) |
| **`/ingest/email`** | POST | Email webhook (subject + body → memory) |
| **`/ingest/meeting`** | POST | Meeting transcription (Zoom/Chime → memory) |
| **`/ingest/generic`** | POST | Generic JSON payload |
| **`/ingest/batch`** | POST | Bulk import (array of memories) |

All ingest endpoints require `Authorization: Bearer INGEST_TOKEN`.

### Health & Monitoring

| Path | Method | Description |
|------|--------|-------------|
| **`/health/ready`** | GET | Liveness check (200 if server running) |
| **`/health/deep`** | GET | Deep health (tests DB, embeddings, vector index) |
| **`/health/metrics`** | GET | Prometheus metrics (memory count, index size, uptime) |
| **`/monitoring`** | GET | Real-time monitoring dashboard (web UI) |

### Demos (Development)

| Path | Description |
|------|-------------|
| **`/demo/organizer`** | Auto-organization test UI |
| **`/demo/checkin`** | Context briefing preview |
| **`/demo/ingest`** | Ingest webhook tester |
| **`/demo/sync`** | Multi-user sync simulator |
| **`/demo/identity`** | Cross-agent identity resolver |
| **`/demo/teams`** | Team creation/management |
| **`/demo/security`** | Security layer (rate limits, audit log, sanitization) |
| **`/demo/versions`** | Version history viewer |
| **`/demo/backup`** | Backup manager (create/restore) |
| **`/demo/notifications`** | Notification system test |

### Assets

| Path | Content-Type | Description |
|------|--------------|-------------|
| **`/proxy.js`** | `application/javascript` | Self-configuring MCP proxy for teams |
| **`/ux-enhance.js`** | `application/javascript` | UX enhancement injection script |

---

## Development

### Prerequisites

- Node.js ≥ 20.0.0
- pnpm ≥ 9.0.0 (or npm)

### Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests (Vitest)
pnpm test

# Dev mode (watch + hot reload)
pnpm dev

# Lint (ESLint + Prettier)
pnpm lint

# Clean build artifacts
pnpm clean
```

### Project Structure

```
shared-brain/
├── packages/
│   ├── core/           # Core data structures
│   │   ├── crdt.ts     # CRDT (HLC, LWW, OR-Set)
│   │   ├── embeddings.ts
│   │   └── store.ts
│   ├── server/         # MCP server
│   │   ├── src/
│   │   │   ├── index.ts          # Entry point
│   │   │   ├── server.ts         # Express app setup
│   │   │   ├── mcp/
│   │   │   │   ├── handler.ts    # MCP request handler
│   │   │   │   ├── tools.ts      # 12 tool registrations
│   │   │   │   └── resources.ts  # MCP resources
│   │   │   ├── auth/
│   │   │   │   ├── jwt-auth.ts   # JWT middleware
│   │   │   │   └── token.ts      # Token issuance
│   │   │   ├── security.ts       # Security layer
│   │   │   ├── monitoring.ts     # Metrics collector
│   │   │   ├── teams.ts          # Team management
│   │   │   ├── notifications.ts  # Notification engine
│   │   │   ├── versioning.ts     # Version history
│   │   │   ├── backup.ts         # Backup manager
│   │   │   ├── hnsw.ts           # HNSW index
│   │   │   ├── fulltext.ts       # BM25 index
│   │   │   ├── organizer.ts      # Auto-organization
│   │   │   ├── auto-enhance.ts   # Smart defaults
│   │   │   ├── ingest.ts         # Passive ingest
│   │   │   ├── identity.ts       # Cross-agent identity
│   │   │   └── (UI pages)
│   │   └── package.json
│   ├── sync/           # Sync engine
│   │   ├── client.ts   # WebSocket client
│   │   ├── relay.ts    # Relay server
│   │   └── merkle.ts   # Merkle tree diff
│   └── cli/            # CLI tool
│       ├── index.ts
│       └── commands/
├── docker/
│   ├── docker-compose.yml  # Relay + PostgreSQL
│   └── Dockerfile
├── models/                 # ONNX model cache (gitignored)
├── data/                   # SQLite databases (gitignored)
├── ARCHITECTURE.md
├── README.md
└── package.json
```

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test --watch

# Coverage
pnpm test --coverage
```

### Docker Development

```bash
# Start relay + PostgreSQL
cd docker
docker compose up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

---

## Contributing

We welcome contributions! Here's how:

1. **Fork** the repository
2. **Create** a feature branch: `git checkout -b feat/your-feature`
3. **Make** your changes with tests
4. **Ensure** all checks pass:
   ```bash
   pnpm build && pnpm test && pnpm lint
   ```
5. **Commit** using conventional commits:
   ```
   feat: add memory_batch_delete tool
   fix: race condition in HNSW index
   docs: update API reference
   refactor: simplify auth middleware
   test: add coverage for conflict resolution
   ```
6. **Push** and open a pull request

### Code Standards

- **TypeScript strict mode** — No `any`, no implicit returns
- **ESM only** — Use `.js` extensions in imports (even for `.ts` files)
- **Tests required** — Add tests for new functionality (Vitest)
- **Conventional commits** — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- **Prettier formatting** — Run `pnpm lint` before committing

### Architecture Decisions

- **sql.js over better-sqlite3** — Pure JS, no native deps, works in serverless
- **HNSW over FAISS** — Pure TypeScript, no Python bindings
- **JWT over sessions** — Stateless, works with load balancers
- **HLC over vector clocks** — Partial ordering without full mesh sync
- **Streamable HTTP over stdio** — Multi-client, works over network

---

## License

[MIT](./LICENSE)

Copyright (c) 2026 Alex Wictor

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
