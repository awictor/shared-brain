import { createServer } from './server.js';
import { Organizer } from './organizer.js';
import { registerOrganizerDemo } from './organizer-demo.js';
import { AutoEnhancer } from './auto-enhance.js';
import { registerCheckinDemo } from './checkin-demo.js';
import { IngestEngine } from './ingest.js';
import { registerIngestDemo } from './ingest-demo.js';
import { registerSyncDemo } from './sync-demo.js';
import { IdentityManager } from './identity.js';
import { registerIdentityDemo } from './identity-demo.js';
import { SecurityLayer } from './security.js';
import { registerSecurityDemo } from './security-demo.js';
import { HNSWIndex } from './hnsw.js';
import { registerTeamOnboarding } from './onboard-team.js';
import { registerOnboarding } from './onboarding.js';
import { registerOnboardingDemo } from './onboarding-demo.js';
import { registerApp } from './app.js';
import { registerUXResearch } from './ux-research.js';
import { registerUXEnhancements } from './ux-enhancements.js';
import { registerHealthChecks } from './healthcheck.js';
import type { Store, Embeddings, VectorIndex, ListOptions, ScopeFilter, Memory, MemoryOperation } from './mcp/handler.js';
// @ts-ignore — sql.js has no type declarations
import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// ─── Environment Configuration ──────────────────────────────────────────────

const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const IS_PRODUCTION = NODE_ENV === 'production';
const MAX_MEMORIES_PER_USER = parseInt(process.env['MAX_MEMORIES_PER_USER'] ?? '10000', 10);
const ALLOWED_ORIGINS = process.env['ALLOWED_ORIGINS']
  ? process.env['ALLOWED_ORIGINS'].split(',').map(o => o.trim())
  : undefined; // undefined = allow all (dev mode)

// ─── Persistent SQLite Store (sql.js — pure JS, no native deps) ─────────────

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  title TEXT,
  type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'personal',
  team_id TEXT,
  org_id TEXT,
  author_id TEXT NOT NULL DEFAULT 'local',
  author_name TEXT NOT NULL DEFAULT 'Local User',
  tags_json TEXT NOT NULL DEFAULT '[]',
  deleted INTEGER NOT NULL DEFAULT 0,
  source_json TEXT NOT NULL DEFAULT '{}',
  relations_json TEXT NOT NULL DEFAULT '[]',
  hlc TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  embedding BLOB
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  hlc TEXT NOT NULL,
  author_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  scope TEXT NOT NULL,
  team_id TEXT,
  org_id TEXT,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_deleted ON memories(deleted);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_operations_synced ON operations(synced);
`;

class SqlJsStore implements Store {
  public db: any = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    const SQL = await initSqlJs();
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(this.dbPath)) {
      const buffer = readFileSync(this.dbPath);
      this.db = new SQL.Database(buffer);
      console.log(`[store] Loaded existing database: ${this.dbPath}`);
    } else {
      this.db = new SQL.Database();
      console.log(`[store] Created new database: ${this.dbPath}`);
    }

    this.db.run(SCHEMA);
    this.save();
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  async createMemory(memory: Memory): Promise<void> {
    // Enforce per-user memory limit
    const countRows = this.db!.exec(
      'SELECT COUNT(*) FROM memories WHERE author_id = ? AND deleted = 0',
      [memory.authorId]
    );
    const userCount = countRows[0]?.values[0]?.[0] as number ?? 0;
    if (userCount >= MAX_MEMORIES_PER_USER) {
      throw new Error(`Memory limit reached: user ${memory.authorId} has ${userCount}/${MAX_MEMORIES_PER_USER} memories`);
    }

    this.db!.run(
      `INSERT INTO memories (id, content, title, type, scope, team_id, org_id, author_id, author_name, tags_json, deleted, source_json, relations_json, hlc, created_at, updated_at, version, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [memory.id, memory.content, memory.title, memory.type, memory.scope, memory.teamId, memory.orgId,
       memory.authorId, memory.authorName, JSON.stringify(memory.tags), memory.deleted ? 1 : 0,
       JSON.stringify(memory.source), JSON.stringify(memory.relations), memory.hlc,
       memory.createdAt, memory.updatedAt, memory.version,
       memory.embedding ? Buffer.from(memory.embedding.buffer) : null]
    );
    this.save();
  }

  async getMemory(id: string): Promise<Memory | null> {
    const rows = this.db!.exec('SELECT * FROM memories WHERE id = ?', [id]);
    if (!rows.length || !rows[0].values.length) return null;
    return this.rowToMemory(rows[0].columns, rows[0].values[0]);
  }

  async updateMemory(id: string, fields: Partial<Memory>): Promise<void> {
    const existing = await this.getMemory(id);
    if (!existing) return;

    const updated = { ...existing, ...fields };
    this.db!.run(
      `UPDATE memories SET content=?, title=?, type=?, scope=?, team_id=?, org_id=?,
       tags_json=?, deleted=?, source_json=?, relations_json=?, hlc=?, updated_at=?, version=?, embedding=?
       WHERE id=?`,
      [updated.content, updated.title, updated.type, updated.scope, updated.teamId, updated.orgId,
       JSON.stringify(updated.tags), updated.deleted ? 1 : 0,
       JSON.stringify(updated.source), JSON.stringify(updated.relations), updated.hlc,
       updated.updatedAt, updated.version,
       updated.embedding ? Buffer.from(updated.embedding.buffer) : null, id]
    );
    this.save();
  }

  async deleteMemory(id: string): Promise<void> {
    this.db!.run('UPDATE memories SET deleted=1, updated_at=? WHERE id=?', [new Date().toISOString(), id]);
    this.save();
  }

  async listMemories(options: ListOptions): Promise<Memory[]> {
    let sql = 'SELECT * FROM memories WHERE deleted = 0';
    const params: any[] = [];

    if (options.scope) {
      const scopeConds: string[] = [];
      if (options.scope.personal) scopeConds.push("scope = 'personal'");
      if (options.scope.teamIds?.length) {
        scopeConds.push(`(scope = 'team' AND team_id IN (${options.scope.teamIds.map(() => '?').join(',')}))`);
        params.push(...options.scope.teamIds);
      }
      if (options.scope.org) scopeConds.push("scope = 'org'");
      if (scopeConds.length) sql += ` AND (${scopeConds.join(' OR ')})`;
    }

    if (options.filters?.types?.length) {
      sql += ` AND type IN (${options.filters.types.map(() => '?').join(',')})`;
      params.push(...options.filters.types);
    }
    if (options.filters?.authorId) {
      sql += ' AND author_id = ?';
      params.push(options.filters.authorId);
    }
    if (options.filters?.since) {
      sql += ' AND created_at >= ?';
      params.push(options.filters.since);
    }
    if (options.filters?.before) {
      sql += ' AND created_at <= ?';
      params.push(options.filters.before);
    }

    const sort = options.sort ?? 'newest';
    if (sort === 'newest') sql += ' ORDER BY created_at DESC';
    else if (sort === 'oldest') sql += ' ORDER BY created_at ASC';
    else sql += ' ORDER BY updated_at DESC';

    sql += ` LIMIT ? OFFSET ?`;
    params.push(options.limit ?? 20, options.offset ?? 0);

    const rows = this.db!.exec(sql, params);
    if (!rows.length) return [];
    return rows[0].values.map((row: any) => this.rowToMemory(rows[0].columns, row));
  }

  async countMemories(): Promise<number> {
    const rows = this.db!.exec('SELECT COUNT(*) as count FROM memories WHERE deleted = 0');
    return rows[0]?.values[0]?.[0] as number ?? 0;
  }

  async createOperation(op: MemoryOperation): Promise<void> {
    this.db!.run(
      `INSERT INTO operations (id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id, synced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [op.id, op.memoryId, op.hlc, op.authorId, op.type, JSON.stringify(op.payload), op.scope, op.teamId, op.orgId, new Date().toISOString()]
    );
    this.save();
  }

  async getPendingOperations(): Promise<MemoryOperation[]> {
    const rows = this.db!.exec('SELECT * FROM operations WHERE synced = 0 ORDER BY hlc ASC');
    if (!rows.length) return [];
    return rows[0].values.map((row: any[]) => {
      const cols = rows[0].columns;
      const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
      return { id: r.id, memoryId: r.memory_id, hlc: r.hlc, authorId: r.author_id, type: r.type, payload: JSON.parse(r.payload_json), scope: r.scope, teamId: r.team_id, orgId: r.org_id };
    });
  }

  async getLastSyncTime(): Promise<string | null> {
    const rows = this.db!.exec("SELECT value FROM sync_state WHERE key = 'last_sync'");
    return rows[0]?.values[0]?.[0] as string ?? null;
  }

  async getAllTags(): Promise<Array<{ tag: string; count: number }>> {
    const rows = this.db!.exec('SELECT tags_json FROM memories WHERE deleted = 0');
    if (!rows.length) return [];
    const tagCounts = new Map<string, number>();
    for (const row of rows[0].values as any[]) {
      const tags: string[] = JSON.parse(row[0] as string);
      for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
    return [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }

  private rowToMemory(columns: string[], row: any): Memory {
    const r = Object.fromEntries(columns.map((c, i) => [c, row[i]])) as any;
    let embedding: Float32Array | null = null;
    if (r.embedding) {
      const buf = r.embedding instanceof Uint8Array ? r.embedding : new Uint8Array(r.embedding);
      embedding = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    }
    return {
      id: r.id, content: r.content, title: r.title ?? null, type: r.type, scope: r.scope,
      teamId: r.team_id ?? null, orgId: r.org_id ?? null, authorId: r.author_id, authorName: r.author_name,
      tags: JSON.parse(r.tags_json || '[]'), embedding, hlc: r.hlc, deleted: r.deleted === 1,
      createdAt: r.created_at, updatedAt: r.updated_at,
      source: JSON.parse(r.source_json || '{}'), relations: JSON.parse(r.relations_json || '[]'), version: r.version,
    };
  }

  /** Returns a user-scoped store that enforces per-user data isolation. */
  forUser(userId: string, userName?: string, teamIds?: string[]): UserScopedStore {
    return new UserScopedStore(this, userId, userName ?? userId, teamIds ?? []);
  }
}

/**
 * UserScopedStore — wraps SqlJsStore to enforce per-user data isolation.
 * Returned by SqlJsStore.forUser(userId).
 */
class UserScopedStore implements Store {
  constructor(
    private readonly inner: SqlJsStore,
    private readonly userId: string,
    private readonly userName: string,
    private readonly teamIds: string[] = [],
  ) {}

  private canRead(m: Memory): boolean {
    if (m.scope === 'personal') return m.authorId === this.userId;
    if (m.scope === 'team') return this.teamIds.includes(m.teamId ?? '');
    if (m.scope === 'org') return true;
    return false;
  }

  private assertOwner(m: Memory): void {
    if (m.authorId !== this.userId) {
      throw new Error(`Access denied: user ${this.userId} cannot modify memory owned by ${m.authorId}`);
    }
  }

  async initialize(): Promise<void> {
    return this.inner.initialize();
  }

  async createMemory(memory: Memory): Promise<void> {
    return this.inner.createMemory({
      ...memory,
      authorId: this.userId,
      authorName: this.userName,
    });
  }

  async getMemory(id: string): Promise<Memory | null> {
    const m = await this.inner.getMemory(id);
    if (!m) return null;
    return this.canRead(m) ? m : null;
  }

  async updateMemory(id: string, fields: Partial<Memory>): Promise<void> {
    const existing = await this.inner.getMemory(id);
    if (!existing) throw new Error(`Memory ${id} not found`);
    this.assertOwner(existing);
    return this.inner.updateMemory(id, fields);
  }

  async deleteMemory(id: string): Promise<void> {
    const existing = await this.inner.getMemory(id);
    if (!existing) throw new Error(`Memory ${id} not found`);
    this.assertOwner(existing);
    return this.inner.deleteMemory(id);
  }

  async listMemories(options: ListOptions): Promise<Memory[]> {
    const scopedOptions = { ...options };
    scopedOptions.scope = { personal: true, teamIds: this.teamIds, org: true };

    const memories = await this.inner.listMemories(scopedOptions);
    return memories.filter(m => this.canRead(m));
  }

  async countMemories(scope?: ScopeFilter): Promise<number> {
    const memories = await this.listMemories({ scope: scope ?? { personal: true, teamIds: this.teamIds, org: true } } as ListOptions);
    return memories.length;
  }

  async createOperation(op: MemoryOperation): Promise<void> {
    return this.inner.createOperation({
      ...op,
      authorId: this.userId,
    });
  }

  async getPendingOperations(): Promise<MemoryOperation[]> {
    return this.inner.getPendingOperations();
  }

  async getLastSyncTime(): Promise<string | null> {
    return this.inner.getLastSyncTime();
  }

  async getAllTags(): Promise<Array<{ tag: string; count: number }>> {
    return this.inner.getAllTags();
  }
}

// ─── Vector Index (HNSW, rebuilt from DB on startup) ─────────────────────────

class PersistentHNSWIndex implements VectorIndex {
  private hnsw: HNSWIndex;
  private store: SqlJsStore;

  constructor(store: SqlJsStore) {
    this.store = store;
    this.hnsw = new HNSWIndex();
  }

  async loadFromStore(): Promise<void> {
    const memories = await this.store.listMemories({ limit: 100000, offset: 0 });
    let loaded = 0;
    for (const m of memories) {
      if (m.embedding) {
        this.hnsw.add(m.id, m.embedding);
        loaded++;
      }
    }
    if (loaded > 0) console.log(`[vectors] HNSW index loaded ${loaded} vectors from database.`);
  }

  add(id: string, vector: Float32Array): void {
    this.hnsw.add(id, vector);
  }

  remove(id: string): void {
    this.hnsw.remove(id);
  }

  search(query: Float32Array, k: number, threshold: number = 0.0): Array<{ id: string; score: number }> {
    return this.hnsw.search(query, k, threshold);
  }

  size(): number {
    return this.hnsw.size();
  }
}

// ─── ONNX Embedding Engine ───────────────────────────────────────────────────

class OnnxEmbeddingEngine implements Embeddings {
  public extractor: any = null;
  private readonly dimensions = 384;
  private readonly modelName = 'Xenova/all-MiniLM-L6-v2';

  async initialize(): Promise<void> {
    console.log(`[embeddings] Loading ONNX model: ${this.modelName} (env=${NODE_ENV})...`);
    const { pipeline, env } = await import('@xenova/transformers');
    // In production, disable the hash-based embeddings fallback — always require ONNX
    if (IS_PRODUCTION) {
      (env as any).allowLocalModels = false;
      (env as any).useBrowserCache = false;
    }
    this.extractor = await pipeline('feature-extraction', this.modelName, { quantized: true });
    console.log(`[embeddings] Model loaded — ${this.dimensions}-dim semantic embeddings ready.`);
  }

  async embed(text: string): Promise<Float32Array> {
    if (!this.extractor) throw new Error('Engine not initialized');
    const output = await this.extractor(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const text of texts) results.push(await this.embed(text));
    return results;
  }

  getDimensions(): number {
    return this.dimensions;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '3100', 10);
const host = process.env['HOST'] ?? '127.0.0.1';
const dbPath = process.env['DB_PATH'] ?? 'C:/Users/awictor/shared-brain/data/brain.db';

const store = new SqlJsStore(dbPath);
const embeddings = new OnnxEmbeddingEngine();
const vectorIndex = new PersistentHNSWIndex(store);

// Create organizer + auto-enhancer before server so MCP tools can use them
const organizer = new Organizer(embeddings, vectorIndex, store);
const autoEnhancer = new AutoEnhancer(organizer, store, embeddings, vectorIndex);

const { app, handler } = await createServer(
  { port, host, dbPath, authToken: process.env['AUTH_TOKEN'] || undefined, toolDeps: { autoEnhancer }, allowedOrigins: ALLOWED_ORIGINS },
  { store, embeddings, vectorIndex },
);

// Load vectors from persisted embeddings into HNSW index
await vectorIndex.loadFromStore();

// Register health check endpoints (before security middleware so ALB can reach /health/*)
registerHealthChecks(app, { store, embeddings, vectorIndex });
console.log(`[health] Health checks → /health/ready, /health/deep, /health/metrics`);

// Wire up security layer (zero-config)
const security = new SecurityLayer(store.db);
const { token: securityToken } = security.initialize();

// Apply security middleware to all routes
app.use(security.securityHeadersMiddleware());
app.use(security.auditMiddleware());

// User identification from request headers (injected by proxy)
app.use('/mcp', (req, _res, next) => {
  const userId = req.headers['x-user-id'] as string ?? 'anonymous';
  const userName = req.headers['x-user-name'] as string ?? userId;
  // Set on the handler so MCP tools use the right identity
  handler.setCurrentUser(userId, userName);
  next();
});

// Route-specific rate limits
app.use('/mcp', security.rateLimitMiddleware(100, 60_000));       // 100/min for MCP
app.use('/ingest', security.rateLimitMiddleware(20, 60_000));     // 20/min for ingest
app.use('/setup', security.rateLimitMiddleware(10, 60_000));      // 10/min for setup

// Input sanitization for write endpoints
app.use('/mcp', security.sanitizeMiddleware());
app.use('/ingest', security.sanitizeMiddleware());

// Security demo dashboard
registerSecurityDemo(app, security);
console.log(`[security] Security dashboard → http://${host}:${port}/demo/security`);

// Wire up cross-agent identity system
const identityManager = new IdentityManager(store.db);
identityManager.initialize();
registerIdentityDemo(app, identityManager);
console.log(`[identity] Cross-agent identity system ready → http://${host}:${port}/demo/identity`);

// Wire up the auto-organizer + demo UI (organizer already created above for AutoEnhancer)
registerOrganizerDemo(app, organizer);
console.log(`[organizer] Auto-organization layer ready → http://${host}:${port}/demo/organizer`);

// Wire up the checkin demo UI
registerCheckinDemo(app, handler, store);
console.log(`[checkin] Context briefing ready → http://${host}:${port}/demo/checkin`);

// Wire up the passive ingest engine + demo UI
const ingestToken = process.env['INGEST_TOKEN'] ?? 'dev-ingest-token';
const ingestEngine = new IngestEngine(store, embeddings, vectorIndex, {
  token: ingestToken,
  minContentLength: parseInt(process.env['INGEST_MIN_LENGTH'] ?? '20', 10),
  deduplicateThreshold: parseFloat(process.env['INGEST_DEDUP_THRESHOLD'] ?? '0.85'),
});
ingestEngine.registerRoutes(app);
registerIngestDemo(app, ingestEngine);
console.log(`[ingest] Passive ingestion webhooks ready → http://${host}:${port}/ingest/{slack,email,meeting,generic,batch}`);
console.log(`[ingest] Demo UI → http://${host}:${port}/demo/ingest`);

// Wire up multi-user sync demo
registerSyncDemo(app, embeddings);
console.log(`[sync-demo] Multi-user sync demonstration → http://${host}:${port}/demo/sync`);

// Wire up onboarding system (zero-config setup, auto-detect, auto-organize, status page)
registerOnboarding(app, { store, identityManager, vectorIndex, embeddings, dbPath });
registerOnboardingDemo(app, { store, identityManager, vectorIndex });
console.log(`[onboarding] Setup wizard → http://${host}:${port}/setup`);
console.log(`[onboarding] Status page → http://${host}:${port}/status`);

// Wire up the unified SPA
registerApp(app);
console.log(`[app] SharedBrain SPA → http://${host}:${port}/app`);

// Wire up UX research tools
registerUXResearch(app);
console.log(`[ux-research] Research tools → /research/analytics, /research/heuristics, /research/test`);

// Wire up UX enhancements (serves /ux-enhance.js for SPA injection)
(app as any).locals = (app as any).locals || {};
(app as any).locals.store = store;
registerUXEnhancements(app);
console.log(`[ux-enhance] UX enhancements script → /ux-enhance.js`);

// Wire up team onboarding page
registerTeamOnboarding(app);
console.log(`[team] Team join page → http://${host}:${port}/join`);

// Serve the proxy script for teammates to download
app.get('/proxy.js', (_req, res) => {
  const serverUrl = process.env['PUBLIC_URL'] ?? `http://${host}:${port}`;
  const script = `#!/usr/bin/env node
/**
 * SharedBrain MCP Proxy — connects your AI agent to the team brain.
 * Points to: ${serverUrl}/mcp
 *
 * On first run, prompts for your user alias and saves to ~/.shared-brain/identity.json
 */
const MCP_URL = '${serverUrl}/mcp';
const path = require('path');
const fs = require('fs');
const readline = require('readline');

const CONFIG_DIR = path.join(require('os').homedir(), '.shared-brain');
const CONFIG_FILE = path.join(CONFIG_DIR, 'identity.json');

async function getIdentity() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }
  // First run — prompt for identity
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) => new Promise(resolve => rl.question(q, resolve));
  process.stderr.write('\\n=== SharedBrain First-Run Setup ===\\n');
  const userId = await ask('Your alias (e.g. jsmith): ');
  const userName = await ask('Display name (e.g. Jane Smith): ');
  rl.close();
  const identity = { userId: userId.trim(), userName: userName.trim() };
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(identity, null, 2));
  process.stderr.write('Identity saved to ' + CONFIG_FILE + '\\n\\n');
  return identity;
}

async function main() {
  const identity = await getIdentity();
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\\n');
    buffer = lines.pop();
    for (const line of lines) { if (line.trim()) handleMessage(line, identity); }
  });
  process.stdin.on('end', () => { if (buffer.trim()) handleMessage(buffer, identity); });
}

async function handleMessage(line, identity) {
  try {
    JSON.parse(line);
    const resp = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'X-User-Id': identity.userId,
        'X-User-Name': identity.userName,
      },
      body: line,
    });
    const text = await resp.text();
    const dataLines = text.split('\\n').filter(l => l.startsWith('data: '));
    for (const dl of dataLines) process.stdout.write(dl.slice(6) + '\\n');
    if (!dataLines.length && text.trim()) process.stdout.write(text.trim() + '\\n');
  } catch (err) {
    try {
      const p = JSON.parse(line);
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: String(err.message || err) }, id: p.id ?? null }) + '\\n');
    } catch { process.stderr.write('Proxy error: ' + err + '\\n'); }
  }
}

main();
`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(script);
});

// User directory API
app.get('/api/users', (_req, res) => {
  try {
    const rows = store.db!.exec(`
      SELECT
        a.user_id,
        a.name as agent_name,
        a.last_seen,
        a.memories_created,
        u.name as display_name,
        u.email
      FROM agents a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.last_seen DESC
    `);

    if (!rows.length || !rows[0].values.length) {
      res.json({ users: [] });
      return;
    }

    // Group by user_id
    const userMap = new Map<string, { userId: string; displayName: string; email: string | null; agents: string[]; memoryCount: number; lastActive: string }>();

    for (const row of rows[0].values) {
      const cols = rows[0].columns;
      const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;

      const existing = userMap.get(r.user_id);
      if (existing) {
        existing.agents.push(r.agent_name);
        existing.memoryCount += r.memories_created ?? 0;
        if (r.last_seen > existing.lastActive) existing.lastActive = r.last_seen;
      } else {
        userMap.set(r.user_id, {
          userId: r.user_id,
          displayName: r.display_name ?? r.user_id,
          email: r.email ?? null,
          agents: [r.agent_name],
          memoryCount: r.memories_created ?? 0,
          lastActive: r.last_seen,
        });
      }
    }

    res.json({ users: [...userMap.values()] });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Failed to list users' });
  }
});

app.listen(port, host, () => {
  console.log(`[shared-brain] MCP server running → http://${host}:${port}/mcp`);
  console.log(`[shared-brain] Database: ${dbPath}`);
  console.log(`[shared-brain] Environment: ${NODE_ENV} | Max memories/user: ${MAX_MEMORIES_PER_USER}`);
  if (ALLOWED_ORIGINS) console.log(`[shared-brain] CORS origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
