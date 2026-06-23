/**
 * Integration tests for SharedBrain MCP server.
 *
 * Starts a real HTTP server, sends MCP JSON-RPC requests via fetch,
 * and validates all 10 tools + health endpoint + auth middleware.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { createServer } from '../server.js';
import type { Store, Embeddings, VectorIndex, Memory, MemoryOperation, ListOptions, ScopeFilter } from '../mcp/handler.js';

// ─── In-memory implementations (mirrors index.ts) ─────────────────────────────

class InMemoryStore implements Store {
  private memories: Map<string, Memory> = new Map();
  private operations: MemoryOperation[] = [];

  async initialize(): Promise<void> {}

  async createMemory(memory: Memory): Promise<void> {
    this.memories.set(memory.id, memory);
  }

  async getMemory(id: string): Promise<Memory | null> {
    return this.memories.get(id) ?? null;
  }

  async updateMemory(id: string, fields: Partial<Memory>): Promise<void> {
    const existing = this.memories.get(id);
    if (existing) {
      this.memories.set(id, { ...existing, ...fields });
    }
  }

  async deleteMemory(id: string): Promise<void> {
    const existing = this.memories.get(id);
    if (existing) {
      this.memories.set(id, { ...existing, deleted: true });
    }
  }

  async listMemories(options: ListOptions): Promise<Memory[]> {
    let results = [...this.memories.values()].filter((m) => !m.deleted);

    if (options.scope) {
      results = results.filter((m) => {
        const s = options.scope!;
        if (s.personal && m.scope === 'personal') return true;
        if (s.teamIds?.length && m.scope === 'team' && m.teamId && s.teamIds.includes(m.teamId)) return true;
        if (s.org && m.scope === 'org') return true;
        if (!s.personal && !s.teamIds?.length && !s.org) return true;
        return false;
      });
    }

    if (options.filters) {
      const f = options.filters;
      if (f.types?.length) results = results.filter((m) => f.types!.includes(m.type));
      if (f.tags?.length) results = results.filter((m) => f.tags!.some((t) => m.tags.includes(t)));
      if (f.authorId) results = results.filter((m) => m.authorId === f.authorId);
      if (f.since) results = results.filter((m) => m.createdAt >= f.since!);
      if (f.before) results = results.filter((m) => m.createdAt <= f.before!);
    }

    const sort = options.sort ?? 'newest';
    if (sort === 'newest') results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (sort === 'oldest') results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    else results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 20));
  }

  async countMemories(): Promise<number> {
    return [...this.memories.values()].filter((m) => !m.deleted).length;
  }

  async createOperation(op: MemoryOperation): Promise<void> {
    this.operations.push(op);
  }

  async getPendingOperations(): Promise<MemoryOperation[]> {
    return this.operations;
  }

  async getLastSyncTime(): Promise<string | null> {
    return null;
  }

  async getAllTags(): Promise<Array<{ tag: string; count: number }>> {
    const tagCounts = new Map<string, number>();
    for (const memory of this.memories.values()) {
      if (memory.deleted) continue;
      for (const tag of memory.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    return [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
  }
}

class InMemoryVectorIndex implements VectorIndex {
  private vectors: Map<string, Float32Array> = new Map();

  add(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  remove(id: string): void {
    this.vectors.delete(id);
  }

  search(query: Float32Array, k: number, threshold: number = 0.0): Array<{ id: string; score: number }> {
    const results: Array<{ id: string; score: number }> = [];
    for (const [id, vector] of this.vectors) {
      let dot = 0;
      for (let i = 0; i < query.length; i++) dot += query[i] * vector[i];
      if (dot >= threshold) results.push({ id, score: dot });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  size(): number {
    return this.vectors.size;
  }
}

class SimpleEmbeddingEngine implements Embeddings {
  private readonly dimensions = 384;

  async initialize(): Promise<void> {}

  async embed(text: string): Promise<Float32Array> {
    return this.hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.hashEmbed(t));
  }

  getDimensions(): number {
    return this.dimensions;
  }

  private hashEmbed(text: string): Float32Array {
    const vector = new Float32Array(this.dimensions);
    const normalized = text.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      vector[i % this.dimensions] += normalized.charCodeAt(i) * (1 + i * 0.001);
    }
    let magnitude = 0;
    for (let i = 0; i < this.dimensions; i++) magnitude += vector[i] * vector[i];
    magnitude = Math.sqrt(magnitude);
    if (magnitude > 0) {
      for (let i = 0; i < this.dimensions; i++) vector[i] /= magnitude;
    }
    return vector;
  }
}

// ─── Test helpers ──────────────────────────────────────────────────────────────

let baseUrl: string;
let server: Server;

/**
 * Send an MCP tool call via JSON-RPC over HTTP and parse the SSE response.
 */
async function callTool(toolName: string, args: Record<string, unknown>, token?: string): Promise<unknown> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  const text = await res.text();

  // SSE format: multiple lines, find "data: " lines
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const json = JSON.parse(line.slice(6));
      // The tool result is in json.result.content[0].text
      if (json.result?.content?.[0]?.text) {
        try {
          return JSON.parse(json.result.content[0].text);
        } catch {
          // If the text is not valid JSON (e.g. markdown export), return raw
          return json.result.content[0].text;
        }
      }
      // If there is an error in the JSON-RPC response
      if (json.error) {
        throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
      }
      return json;
    }
  }

  throw new Error(`No data line found in SSE response: ${text}`);
}

/**
 * Send a raw POST to /mcp and return HTTP status (for auth tests).
 */
async function rawPost(path: string, body: unknown, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

// ─── Test suite (no auth) ──────────────────────────────────────────────────────

describe('SharedBrain MCP Server — Integration Tests', () => {
  beforeAll(async () => {
    const { app } = await createServer(
      { port: 0, host: '127.0.0.1', dbPath: ':memory:' },
      {
        store: new InMemoryStore(),
        embeddings: new SimpleEmbeddingEngine(),
        vectorIndex: new InMemoryVectorIndex(),
      },
    );

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  // ─── Health endpoint ─────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns ok status with service info', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('shared-brain');
      expect(data.version).toBe('0.1.0');
      expect(data.timestamp).toBeDefined();
    });
  });

  // ─── memory_store ────────────────────────────────────────────────────────────

  describe('memory_store', () => {
    it('stores a memory and returns an ID', async () => {
      const result = await callTool('memory_store', {
        content: 'TypeScript is a typed superset of JavaScript.',
        type: 'fact',
        title: 'TypeScript basics',
        tags: ['typescript', 'programming'],
      }) as { id: string; message: string };

      expect(result.id).toBeDefined();
      expect(result.id).toHaveLength(36); // UUID format
      expect(result.message).toContain('stored successfully');
    });
  });

  // ─── memory_search ───────────────────────────────────────────────────────────

  describe('memory_search', () => {
    it('finds stored memory by semantic similarity', async () => {
      // Store a memory first
      await callTool('memory_store', {
        content: 'Vitest is a fast unit testing framework for Vite projects.',
        type: 'fact',
        tags: ['testing'],
      });

      // Search for it
      const results = await callTool('memory_search', {
        query: 'unit testing framework',
        limit: 5,
        threshold: 0.1,
      }) as Array<{ memory: { content: string }; score: number }>;

      expect(results.length).toBeGreaterThan(0);
      const found = results.find((r) => r.memory.content.includes('Vitest'));
      expect(found).toBeDefined();
      expect(found!.score).toBeGreaterThan(0);
    });
  });

  // ─── memory_get ──────────────────────────────────────────────────────────────

  describe('memory_get', () => {
    it('retrieves a memory by ID with correct content', async () => {
      const stored = await callTool('memory_store', {
        content: 'Express is a minimal web framework for Node.js.',
        type: 'fact',
        title: 'Express framework',
      }) as { id: string };

      const retrieved = await callTool('memory_get', { id: stored.id }) as { id: string; content: string; title: string };

      expect(retrieved.id).toBe(stored.id);
      expect(retrieved.content).toBe('Express is a minimal web framework for Node.js.');
      expect(retrieved.title).toBe('Express framework');
    });

    it('returns error for non-existent ID', async () => {
      const result = await callTool('memory_get', { id: '00000000-0000-0000-0000-000000000000' }) as { error: string };
      expect(result.error).toContain('not found');
    });
  });

  // ─── memory_update ───────────────────────────────────────────────────────────

  describe('memory_update', () => {
    it('updates content and confirms success', async () => {
      const stored = await callTool('memory_store', {
        content: 'Original content here.',
        type: 'fact',
      }) as { id: string };

      const updateResult = await callTool('memory_update', {
        id: stored.id,
        content: 'Updated content with new information.',
        tags: { add: ['updated'] },
      }) as { success: boolean; message: string };

      expect(updateResult.success).toBe(true);
      expect(updateResult.message).toContain('updated successfully');

      // Verify the update persisted
      const retrieved = await callTool('memory_get', { id: stored.id }) as { content: string; tags: string[] };
      expect(retrieved.content).toBe('Updated content with new information.');
      expect(retrieved.tags).toContain('updated');
    });
  });

  // ─── memory_delete ───────────────────────────────────────────────────────────

  describe('memory_delete', () => {
    it('soft-deletes a memory so it no longer appears', async () => {
      const stored = await callTool('memory_store', {
        content: 'This memory will be deleted.',
        type: 'context',
      }) as { id: string };

      const deleteResult = await callTool('memory_delete', { id: stored.id }) as { success: boolean; message: string };
      expect(deleteResult.success).toBe(true);
      expect(deleteResult.message).toContain('deleted');

      // Verify it is gone from get
      const retrieved = await callTool('memory_get', { id: stored.id }) as { error: string };
      expect(retrieved.error).toContain('not found');
    });
  });

  // ─── memory_list ─────────────────────────────────────────────────────────────

  describe('memory_list', () => {
    it('lists all non-deleted memories with correct total count', async () => {
      const result = await callTool('memory_list', {
        sort: 'newest',
        limit: 50,
      }) as { memories: unknown[]; total: number };

      expect(result.memories).toBeDefined();
      expect(Array.isArray(result.memories)).toBe(true);
      expect(result.total).toBeGreaterThan(0);
      expect(result.memories.length).toBe(result.total);
    });

    it('filters by type', async () => {
      await callTool('memory_store', {
        content: 'A procedure for deploying to production.',
        type: 'procedure',
        tags: ['deploy'],
      });

      const result = await callTool('memory_list', {
        filters: { types: ['procedure'] },
        limit: 50,
      }) as { memories: Array<{ type: string }> };

      expect(result.memories.length).toBeGreaterThan(0);
      for (const m of result.memories) {
        expect(m.type).toBe('procedure');
      }
    });
  });

  // ─── memory_relate ───────────────────────────────────────────────────────────

  describe('memory_relate', () => {
    it('finds semantically related memories', async () => {
      // Store two related memories
      const m1 = await callTool('memory_store', {
        content: 'React hooks allow functional components to use state and lifecycle features.',
        type: 'fact',
        tags: ['react'],
      }) as { id: string };

      await callTool('memory_store', {
        content: 'useState and useEffect are the most commonly used React hooks.',
        type: 'fact',
        tags: ['react'],
      });

      // Find related memories from m1
      const related = await callTool('memory_relate', {
        id: m1.id,
        limit: 5,
        threshold: 0.1,
      }) as Array<{ memory: { content: string }; score: number }>;

      expect(related.length).toBeGreaterThan(0);
      // The other React hooks memory should appear as related
      const found = related.find((r) => r.memory.content.includes('useState'));
      expect(found).toBeDefined();
      expect(found!.score).toBeGreaterThan(0);
    });
  });

  // ─── sync_status ─────────────────────────────────────────────────────────────

  describe('sync_status', () => {
    it('returns pending operations count and vector count', async () => {
      const status = await callTool('sync_status', {}) as {
        pendingOps: number;
        lastSyncTime: string | null;
        vectorCount: number;
      };

      expect(status.pendingOps).toBeGreaterThan(0); // We have created several memories
      expect(status.lastSyncTime).toBeNull(); // In-memory store never syncs
      expect(status.vectorCount).toBeGreaterThan(0);
    });
  });

  // ─── memory_import ───────────────────────────────────────────────────────────

  describe('memory_import', () => {
    it('bulk imports 3 memories and returns their IDs', async () => {
      const result = await callTool('memory_import', {
        memories: [
          { content: 'Import item one — Docker containers.', type: 'fact', tags: ['docker'] },
          { content: 'Import item two — Kubernetes orchestration.', type: 'fact', tags: ['k8s'] },
          { content: 'Import item three — Terraform IaC.', type: 'procedure', tags: ['terraform'] },
        ],
        scope: 'personal',
      }) as { imported: number; ids: string[] };

      expect(result.imported).toBe(3);
      expect(result.ids).toHaveLength(3);
      for (const id of result.ids) {
        expect(id).toHaveLength(36);
      }
    });
  });

  // ─── memory_export ───────────────────────────────────────────────────────────

  describe('memory_export', () => {
    it('exports memories as JSON with correct count', async () => {
      const exported = await callTool('memory_export', {
        format: 'json',
      });

      // memory_export returns data directly — callTool already JSON.parsed it into an array
      const parsed = Array.isArray(exported) ? exported : JSON.parse(exported as string);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      // Each exported memory should have content
      expect(parsed[0].content).toBeDefined();
    });

    it('exports as markdown', async () => {
      const exported = await callTool('memory_export', {
        format: 'markdown',
      }) as string;

      expect(exported).toContain('# SharedBrain Export');
      expect(exported).toContain('Count:');
    });
  });
});

// ─── Auth middleware tests ──────────────────────────────────────────────────────

describe('SharedBrain MCP Server — Auth Middleware', () => {
  let authServer: Server;
  let authBaseUrl: string;
  const AUTH_TOKEN = 'test-secret-token-12345';

  beforeAll(async () => {
    const { app } = await createServer(
      { port: 0, host: '127.0.0.1', dbPath: ':memory:', authToken: AUTH_TOKEN },
      {
        store: new InMemoryStore(),
        embeddings: new SimpleEmbeddingEngine(),
        vectorIndex: new InMemoryVectorIndex(),
      },
    );

    await new Promise<void>((resolve) => {
      authServer = app.listen(0, '127.0.0.1', () => {
        const addr = authServer.address();
        if (addr && typeof addr === 'object') {
          authBaseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      authServer.close(() => resolve());
    });
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await fetch(`${authBaseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'sync_status', arguments: {} },
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('Missing Authorization');
  });

  it('returns 403 when an invalid token is provided', async () => {
    const res = await fetch(`${authBaseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-token',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'sync_status', arguments: {} },
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Invalid token');
  });

  it('returns 401 when Authorization format is wrong', async () => {
    const res = await fetch(`${authBaseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic some-credentials',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'sync_status', arguments: {} },
      }),
    });
    expect(res.status).toBe(401);
  });

  it('succeeds with valid Bearer token', async () => {
    const res = await fetch(`${authBaseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'sync_status', arguments: {} },
      }),
    });
    // Should not be 401 or 403
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('health endpoint bypasses auth (no auth on /health)', async () => {
    const res = await fetch(`${authBaseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });
});
