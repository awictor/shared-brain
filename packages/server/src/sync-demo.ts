/**
 * Sync Demo — Self-contained demonstration of multi-user CRDT sync.
 *
 * GET /demo/sync renders a two-panel UI (Alice | Bob) showing:
 * - Scope-based visibility (team memories sync, personal don't)
 * - LWW per-field conflict resolution with HLC timestamps
 * - OR-Set tag merging
 * - Operation replay log
 *
 * All state is in-memory. No external dependencies.
 */

import type { Application, Request, Response } from 'express';
import type { Embeddings } from './mcp/handler.js';
import { randomUUID } from 'node:crypto';

// ─── Inline CRDT Primitives (self-contained, mirrors packages/core/src/crdt/) ─

type HLC = string;

interface HLCState {
  wallMs: number;
  counter: number;
  nodeId: string;
}

class HybridLogicalClock {
  private wallMs: number;
  private counter: number;
  private readonly nodeId: string;
  private static readonly MAX_DRIFT_MS = 5 * 60 * 1000;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.wallMs = Date.now();
    this.counter = 0;
  }

  now(): HLC {
    const physicalNow = Date.now();
    if (physicalNow > this.wallMs) {
      this.wallMs = physicalNow;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return HybridLogicalClock.format(this.wallMs, this.counter, this.nodeId);
  }

  receive(remote: HLC): HLC {
    const remoteState = HybridLogicalClock.parse(remote);
    const physicalNow = Date.now();
    if (remoteState.wallMs - physicalNow > HybridLogicalClock.MAX_DRIFT_MS) {
      throw new Error(`Remote HLC drift exceeds maximum`);
    }
    if (physicalNow > this.wallMs && physicalNow > remoteState.wallMs) {
      this.wallMs = physicalNow;
      this.counter = 0;
    } else if (this.wallMs === remoteState.wallMs) {
      this.counter = Math.max(this.counter, remoteState.counter) + 1;
    } else if (remoteState.wallMs > this.wallMs) {
      this.wallMs = remoteState.wallMs;
      this.counter = remoteState.counter + 1;
    } else {
      this.counter++;
    }
    return HybridLogicalClock.format(this.wallMs, this.counter, this.nodeId);
  }

  static parse(hlc: HLC): HLCState {
    const parts = hlc.split(':');
    if (parts.length < 3) throw new Error(`Invalid HLC: "${hlc}"`);
    return {
      wallMs: parseInt(parts[0], 10),
      counter: parseInt(parts[1], 16),
      nodeId: parts.slice(2).join(':'),
    };
  }

  static compare(a: HLC, b: HLC): -1 | 0 | 1 {
    const pa = HybridLogicalClock.parse(a);
    const pb = HybridLogicalClock.parse(b);
    if (pa.wallMs !== pb.wallMs) return pa.wallMs < pb.wallMs ? -1 : 1;
    if (pa.counter !== pb.counter) return pa.counter < pb.counter ? -1 : 1;
    if (pa.nodeId !== pb.nodeId) return pa.nodeId < pb.nodeId ? -1 : 1;
    return 0;
  }

  static format(wallMs: number, counter: number, nodeId: string): HLC {
    return `${wallMs}:${counter.toString(16).padStart(4, '0')}:${nodeId}`;
  }
}

interface LWWField<T> {
  value: T;
  hlc: HLC;
}

function mergeLWW<T>(local: LWWField<T>, remote: LWWField<T>): LWWField<T> {
  const cmp = HybridLogicalClock.compare(local.hlc, remote.hlc);
  return cmp >= 0 ? local : remote;
}

// ─── Domain Types ───────────────────────────────────────────────────────────────

interface SyncMemory {
  id: string;
  title: LWWField<string>;
  content: LWWField<string>;
  scope: LWWField<'personal' | 'team'>;
  tags: string[];
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

interface SyncOperation {
  id: string;
  memoryId: string;
  type: 'create' | 'update';
  authorId: string;
  authorName: string;
  scope: 'personal' | 'team';
  hlc: HLC;
  fields: Record<string, { value: any; hlc: HLC }>;
  timestamp: string;
}

interface SyncLogEntry {
  timestamp: string;
  direction: 'alice-to-bob' | 'bob-to-alice' | 'system';
  message: string;
  opId: string;
}

// ─── In-Memory Brain Instance ───────────────────────────────────────────────────

class BrainInstance {
  readonly userId: string;
  readonly userName: string;
  readonly clock: HybridLogicalClock;
  memories: Map<string, SyncMemory> = new Map();
  pendingOps: SyncOperation[] = [];
  vectors: Map<string, Float32Array> = new Map();

  constructor(userId: string, userName: string) {
    this.userId = userId;
    this.userName = userName;
    this.clock = new HybridLogicalClock(userId);
  }

  store(title: string, content: string, scope: 'personal' | 'team', tags: string[] = []): SyncOperation {
    const hlc = this.clock.now();
    const id = randomUUID();
    const now = new Date().toISOString();

    const memory: SyncMemory = {
      id,
      title: { value: title, hlc },
      content: { value: content, hlc },
      scope: { value: scope, hlc },
      tags,
      authorId: this.userId,
      authorName: this.userName,
      createdAt: now,
      updatedAt: now,
    };

    this.memories.set(id, memory);

    const op: SyncOperation = {
      id: randomUUID(),
      memoryId: id,
      type: 'create',
      authorId: this.userId,
      authorName: this.userName,
      scope,
      hlc,
      fields: {
        title: { value: title, hlc },
        content: { value: content, hlc },
        scope: { value: scope, hlc },
        tags: { value: tags, hlc },
      },
      timestamp: now,
    };

    this.pendingOps.push(op);
    return op;
  }

  update(memoryId: string, fields: { title?: string; content?: string }): SyncOperation | null {
    const memory = this.memories.get(memoryId);
    if (!memory) return null;

    const hlc = this.clock.now();
    const now = new Date().toISOString();
    const opFields: Record<string, { value: any; hlc: HLC }> = {};

    if (fields.title !== undefined) {
      memory.title = { value: fields.title, hlc };
      opFields.title = { value: fields.title, hlc };
    }
    if (fields.content !== undefined) {
      memory.content = { value: fields.content, hlc };
      opFields.content = { value: fields.content, hlc };
    }
    memory.updatedAt = now;

    const op: SyncOperation = {
      id: randomUUID(),
      memoryId,
      type: 'update',
      authorId: this.userId,
      authorName: this.userName,
      scope: memory.scope.value,
      hlc,
      fields: opFields,
      timestamp: now,
    };

    this.pendingOps.push(op);
    return op;
  }

  applyRemoteOp(op: SyncOperation): { applied: boolean; conflicts: string[] } {
    const conflicts: string[] = [];

    // Advance local clock with remote HLC
    this.clock.receive(op.hlc);

    if (op.type === 'create') {
      if (this.memories.has(op.memoryId)) {
        // Already exists — merge fields
        return this.mergeFields(op);
      }
      const memory: SyncMemory = {
        id: op.memoryId,
        title: op.fields.title ?? { value: 'Untitled', hlc: op.hlc },
        content: op.fields.content ?? { value: '', hlc: op.hlc },
        scope: op.fields.scope ?? { value: op.scope, hlc: op.hlc },
        tags: op.fields.tags?.value ?? [],
        authorId: op.authorId,
        authorName: op.authorName,
        createdAt: op.timestamp,
        updatedAt: op.timestamp,
      };
      this.memories.set(op.memoryId, memory);
      return { applied: true, conflicts: [] };
    }

    return this.mergeFields(op);
  }

  private mergeFields(op: SyncOperation): { applied: boolean; conflicts: string[] } {
    const memory = this.memories.get(op.memoryId);
    if (!memory) {
      // Create skeleton from op
      const mem: SyncMemory = {
        id: op.memoryId,
        title: op.fields.title ?? { value: 'Untitled', hlc: op.hlc },
        content: op.fields.content ?? { value: '', hlc: op.hlc },
        scope: op.fields.scope ?? { value: op.scope, hlc: op.hlc },
        tags: op.fields.tags?.value ?? [],
        authorId: op.authorId,
        authorName: op.authorName,
        createdAt: op.timestamp,
        updatedAt: op.timestamp,
      };
      this.memories.set(op.memoryId, mem);
      return { applied: true, conflicts: [] };
    }

    const conflicts: string[] = [];

    if (op.fields.title) {
      const merged = mergeLWW(memory.title, op.fields.title);
      if (merged !== memory.title) {
        conflicts.push(`title: "${memory.title.value}" -> "${op.fields.title.value}" (remote HLC wins)`);
      } else if (op.fields.title.value !== memory.title.value) {
        conflicts.push(`title: kept "${memory.title.value}" (local HLC wins over "${op.fields.title.value}")`);
      }
      memory.title = merged;
    }

    if (op.fields.content) {
      const merged = mergeLWW(memory.content, op.fields.content);
      if (merged !== memory.content) {
        conflicts.push(`content: local -> remote (remote HLC wins)`);
      } else if (op.fields.content.value !== memory.content.value) {
        conflicts.push(`content: kept local (local HLC wins)`);
      }
      memory.content = merged;
    }

    if (op.fields.scope) {
      memory.scope = mergeLWW(memory.scope, op.fields.scope);
    }

    if (op.fields.tags) {
      // Simple union for demo
      const allTags = new Set([...memory.tags, ...op.fields.tags.value]);
      memory.tags = [...allTags];
    }

    memory.updatedAt = op.timestamp;
    return { applied: true, conflicts };
  }

  getVisibleMemories(): SyncMemory[] {
    return [...this.memories.values()];
  }

  drainPendingOps(): SyncOperation[] {
    const ops = [...this.pendingOps];
    this.pendingOps = [];
    return ops;
  }
}

// ─── In-Process Relay ───────────────────────────────────────────────────────────

class SyncRelay {
  private alice: BrainInstance;
  private bob: BrainInstance;
  log: SyncLogEntry[] = [];

  constructor(alice: BrainInstance, bob: BrainInstance) {
    this.alice = alice;
    this.bob = bob;
  }

  sync(): { synced: number; conflicts: string[] } {
    let synced = 0;
    const allConflicts: string[] = [];

    // Drain Alice's pending ops and route to Bob
    const aliceOps = this.alice.drainPendingOps();
    for (const op of aliceOps) {
      if (op.scope === 'team') {
        const result = this.bob.applyRemoteOp(op);
        if (result.applied) synced++;
        allConflicts.push(...result.conflicts);
        this.log.push({
          timestamp: new Date().toISOString(),
          direction: 'alice-to-bob',
          message: result.conflicts.length > 0
            ? `${op.type} "${op.fields.title?.value ?? op.memoryId}" [CONFLICT: ${result.conflicts.join('; ')}]`
            : `${op.type} "${op.fields.title?.value ?? 'field update'}" (scope=team)`,
          opId: op.id,
        });
      } else {
        this.log.push({
          timestamp: new Date().toISOString(),
          direction: 'alice-to-bob',
          message: `BLOCKED: "${op.fields.title?.value ?? 'update'}" (scope=personal, not routed)`,
          opId: op.id,
        });
      }
    }

    // Drain Bob's pending ops and route to Alice
    const bobOps = this.bob.drainPendingOps();
    for (const op of bobOps) {
      if (op.scope === 'team') {
        const result = this.alice.applyRemoteOp(op);
        if (result.applied) synced++;
        allConflicts.push(...result.conflicts);
        this.log.push({
          timestamp: new Date().toISOString(),
          direction: 'bob-to-alice',
          message: result.conflicts.length > 0
            ? `${op.type} "${op.fields.title?.value ?? op.memoryId}" [CONFLICT: ${result.conflicts.join('; ')}]`
            : `${op.type} "${op.fields.title?.value ?? 'field update'}" (scope=team)`,
          opId: op.id,
        });
      } else {
        this.log.push({
          timestamp: new Date().toISOString(),
          direction: 'bob-to-alice',
          message: `BLOCKED: "${op.fields.title?.value ?? 'update'}" (scope=personal, not routed)`,
          opId: op.id,
        });
      }
    }

    if (synced === 0 && aliceOps.length === 0 && bobOps.length === 0) {
      this.log.push({
        timestamp: new Date().toISOString(),
        direction: 'system',
        message: 'No pending operations to sync',
        opId: '-',
      });
    }

    return { synced, conflicts: allConflicts };
  }

  getLog(): SyncLogEntry[] {
    return this.log;
  }

  clearLog(): void {
    this.log = [];
  }
}

// ─── Route Registration ─────────────────────────────────────────────────────────

export function registerSyncDemo(app: Application, embeddings: Embeddings): void {
  const alice = new BrainInstance('alice-node-01', 'Alice');
  const bob = new BrainInstance('bob-node-02', 'Bob');
  const relay = new SyncRelay(alice, bob);

  // Seed with example memories
  alice.store('Sprint planning notes', 'We decided to focus on sync infrastructure this sprint. Key deliverable: relay server + CRDT merge.', 'team', ['engineering', 'sprint']);
  alice.store('My personal TODO', 'Pick up groceries, call dentist', 'personal', ['personal']);
  bob.store('API rate limits research', 'Found that upstream API supports 1000 req/min with burst to 2000. Need to implement token bucket.', 'team', ['engineering', 'api']);

  // Initial sync to demonstrate routing
  relay.sync();

  // ─── API Endpoints ──────────────────────────────────────────────────────────

  app.get('/demo/sync', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(SYNC_DEMO_HTML);
  });

  app.get('/api/sync-demo/state', (_req: Request, res: Response) => {
    const serialize = (m: SyncMemory) => ({
      id: m.id,
      title: m.title.value,
      titleHlc: m.title.hlc,
      content: m.content.value,
      contentHlc: m.content.hlc,
      scope: m.scope.value,
      tags: m.tags,
      authorId: m.authorId,
      authorName: m.authorName,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    });

    res.json({
      alice: {
        userId: alice.userId,
        memories: alice.getVisibleMemories().map(serialize),
        pendingOps: alice.pendingOps.length,
      },
      bob: {
        userId: bob.userId,
        memories: bob.getVisibleMemories().map(serialize),
        pendingOps: bob.pendingOps.length,
      },
      log: relay.getLog().slice(-50),
    });
  });

  app.post('/api/sync-demo/store', (req: Request, res: Response) => {
    const { user, title, content, scope, tags } = req.body;
    if (!user || !title || !content || !scope) {
      res.status(400).json({ error: 'user, title, content, scope required' });
      return;
    }

    const instance = user === 'alice' ? alice : bob;
    const op = instance.store(title, content, scope, tags ?? []);
    res.json({ success: true, op: { id: op.id, memoryId: op.memoryId, hlc: op.hlc } });
  });

  app.post('/api/sync-demo/update', (req: Request, res: Response) => {
    const { user, memoryId, title, content } = req.body;
    if (!user || !memoryId) {
      res.status(400).json({ error: 'user, memoryId required' });
      return;
    }

    const instance = user === 'alice' ? alice : bob;
    const op = instance.update(memoryId, { title, content });
    if (!op) {
      res.status(404).json({ error: 'Memory not found in this instance' });
      return;
    }
    res.json({ success: true, op: { id: op.id, memoryId: op.memoryId, hlc: op.hlc } });
  });

  app.post('/api/sync-demo/sync', (_req: Request, res: Response) => {
    const result = relay.sync();
    res.json(result);
  });

  app.post('/api/sync-demo/reset', (_req: Request, res: Response) => {
    alice.memories.clear();
    alice.pendingOps = [];
    bob.memories.clear();
    bob.pendingOps = [];
    relay.clearLog();

    // Re-seed
    alice.store('Sprint planning notes', 'We decided to focus on sync infrastructure this sprint.', 'team', ['engineering', 'sprint']);
    alice.store('My personal TODO', 'Pick up groceries, call dentist', 'personal', ['personal']);
    bob.store('API rate limits research', 'Upstream API supports 1000 req/min with burst to 2000.', 'team', ['engineering', 'api']);
    relay.sync();

    res.json({ success: true, message: 'Demo reset' });
  });

  // Conflict demo: both edit same memory simultaneously
  app.post('/api/sync-demo/conflict-demo', (_req: Request, res: Response) => {
    // Create a shared memory
    const op = alice.store('Shared design doc', 'Initial architecture proposal for the sync layer.', 'team', ['design']);
    relay.sync();

    // Now both edit it at the same time (simulated)
    const memId = op.memoryId;

    // Alice edits title (her clock is slightly ahead because she just created it)
    alice.update(memId, { title: 'Sync Layer Architecture v2' });

    // Bob edits content (his clock ticks independently)
    bob.update(memId, { content: 'Revised: Using CRDTs with HLC for causal ordering. LWW per-field with OR-Set tags.' });

    // Sync — both changes should merge cleanly (different fields)
    const result = relay.sync();

    res.json({
      success: true,
      message: 'Conflict demo executed: Alice edited title, Bob edited content on same memory',
      syncResult: result,
      finalState: {
        aliceSees: {
          title: alice.memories.get(memId)?.title.value,
          titleHlc: alice.memories.get(memId)?.title.hlc,
          content: alice.memories.get(memId)?.content.value,
          contentHlc: alice.memories.get(memId)?.content.hlc,
        },
        bobSees: {
          title: bob.memories.get(memId)?.title.value,
          titleHlc: bob.memories.get(memId)?.title.hlc,
          content: bob.memories.get(memId)?.content.value,
          contentHlc: bob.memories.get(memId)?.content.hlc,
        },
      },
    });
  });

  console.log(`[sync-demo] Sync demonstration ready → /demo/sync`);
}

// ─── Demo HTML ──────────────────────────────────────────────────────────────────

const SYNC_DEMO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain — Multi-User Sync Demo</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#232F3E;--surface:#2a3a4a;--card:#1e2d3d;--border:#3a4a5a;
  --text:#F5F3EF;--muted:#a0aab4;--accent:#FF6100;--accent-dim:#cc4e00;
  --success:#10b981;--warning:#f59e0b;--danger:#ef4444;
  --alice:#60a5fa;--bob:#a78bfa;
}
body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:20px}
h1{font-size:28px;font-weight:700;text-align:center;margin-bottom:4px}
h1 span{color:var(--accent)}
.subtitle{text-align:center;color:var(--muted);font-size:14px;margin-bottom:24px}

/* Layout */
.controls{display:flex;gap:12px;justify-content:center;margin-bottom:24px;flex-wrap:wrap}
.btn{cursor:pointer;background:var(--accent);border:none;color:#fff;font-weight:600;padding:10px 20px;border-radius:8px;font-size:14px;transition:all .2s;display:inline-flex;align-items:center;gap:8px}
.btn:hover{background:var(--accent-dim);transform:translateY(-1px)}
.btn:active{transform:translateY(0)}
.btn-outline{background:transparent;border:2px solid var(--accent);color:var(--accent)}
.btn-outline:hover{background:var(--accent);color:#fff}
.btn-danger{background:var(--danger)}
.btn-danger:hover{background:#dc2626}
.btn-success{background:var(--success)}
.btn-success:hover{background:#059669}

.panels{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
@media(max-width:900px){.panels{grid-template-columns:1fr}}

.panel{background:var(--surface);border:2px solid var(--border);border-radius:12px;overflow:hidden}
.panel-alice{border-color:var(--alice)}
.panel-bob{border-color:var(--bob)}
.panel-header{padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--border)}
.panel-alice .panel-header{background:rgba(96,165,250,0.08)}
.panel-bob .panel-header{background:rgba(167,139,250,0.08)}
.avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;color:#fff}
.avatar-alice{background:var(--alice)}
.avatar-bob{background:var(--bob)}
.panel-title{font-weight:600;font-size:16px}
.panel-meta{font-size:12px;color:var(--muted)}
.pending-badge{background:var(--warning);color:#000;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;margin-left:auto}
.panel-body{padding:16px 20px;max-height:400px;overflow-y:auto}

/* Memory cards */
.memory{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:10px;transition:all .2s;position:relative}
.memory:hover{border-color:var(--accent)}
.memory-synced{border-left:3px solid var(--success)}
.memory-local{border-left:3px solid var(--muted)}
.memory-remote-alice{border-left:3px solid var(--alice)}
.memory-remote-bob{border-left:3px solid var(--bob)}
.memory-title{font-weight:600;font-size:14px;margin-bottom:4px;display:flex;align-items:center;gap:8px}
.memory-content{font-size:13px;color:var(--muted);margin-bottom:8px;line-height:1.4}
.memory-meta{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.memory-tag{font-size:10px;padding:2px 6px;background:var(--bg);border:1px solid var(--border);border-radius:4px;color:var(--muted)}
.memory-scope{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:600;text-transform:uppercase}
.scope-team{background:rgba(16,185,129,0.15);color:var(--success)}
.scope-personal{background:rgba(239,68,68,0.15);color:var(--danger)}
.memory-hlc{font-size:10px;color:var(--muted);margin-left:auto;font-family:monospace;opacity:0.7}
.origin-badge{font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.origin-alice{background:rgba(96,165,250,0.2);color:var(--alice)}
.origin-bob{background:rgba(167,139,250,0.2);color:var(--bob)}
.edit-btn{position:absolute;top:8px;right:8px;background:var(--surface);border:1px solid var(--border);color:var(--muted);font-size:11px;padding:3px 8px;border-radius:4px;cursor:pointer;opacity:0;transition:opacity .2s}
.memory:hover .edit-btn{opacity:1}
.edit-btn:hover{border-color:var(--accent);color:var(--accent)}

/* Sync log */
.log-section{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.log-header{padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px}
.log-header h3{font-size:14px;font-weight:600}
.log-count{font-size:11px;background:var(--accent);color:#fff;padding:1px 8px;border-radius:10px;font-weight:600}
.log-body{max-height:300px;overflow-y:auto;padding:12px 20px}
.log-entry{display:flex;gap:12px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(58,74,90,0.5);font-size:13px}
.log-entry:last-child{border-bottom:none}
.log-time{font-size:11px;color:var(--muted);font-family:monospace;min-width:80px;flex-shrink:0}
.log-dir{font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;min-width:90px;text-align:center;flex-shrink:0}
.dir-alice-to-bob{background:rgba(96,165,250,0.15);color:var(--alice)}
.dir-bob-to-alice{background:rgba(167,139,250,0.15);color:var(--bob)}
.dir-system{background:rgba(160,170,180,0.15);color:var(--muted)}
.log-msg{color:var(--text);line-height:1.4}
.log-msg .blocked{color:var(--danger);font-weight:600}
.log-msg .conflict{color:var(--warning);font-weight:600}
.log-empty{text-align:center;padding:24px;color:var(--muted);font-size:13px}

/* Store form modal */
.modal-overlay{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:1000;align-items:center;justify-content:center}
.modal-overlay.active{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;width:90%;max-width:500px}
.modal h3{margin-bottom:16px;font-size:18px}
.form-group{margin-bottom:14px}
.form-group label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}
.form-group input,.form-group textarea,.form-group select{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text);font-size:14px;outline:none;transition:border-color .2s}
.form-group input:focus,.form-group textarea:focus,.form-group select:focus{border-color:var(--accent)}
.form-group textarea{min-height:80px;resize:vertical}
.form-row{display:flex;gap:12px}
.form-row>*{flex:1}
.form-actions{display:flex;gap:12px;justify-content:flex-end;margin-top:20px}

/* Conflict panel */
.conflict-result{background:var(--card);border:2px solid var(--warning);border-radius:12px;padding:20px;margin-bottom:24px;display:none}
.conflict-result.active{display:block}
.conflict-title{font-size:16px;font-weight:700;color:var(--warning);margin-bottom:12px;display:flex;align-items:center;gap:8px}
.conflict-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.conflict-cell{background:var(--surface);border-radius:8px;padding:12px}
.conflict-cell h4{font-size:12px;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.conflict-cell .field{margin-bottom:8px}
.conflict-cell .field-label{font-size:11px;color:var(--muted)}
.conflict-cell .field-value{font-size:14px;font-weight:500}
.conflict-cell .field-hlc{font-size:10px;color:var(--accent);font-family:monospace}

/* Toast */
.toast{position:fixed;bottom:20px;right:20px;background:var(--success);color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;opacity:0;transform:translateY(10px);transition:all .3s;z-index:2000;pointer-events:none}
.toast.show{opacity:1;transform:translateY(0)}

/* Pulse animation for sync button */
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,97,0,0.4)}50%{box-shadow:0 0 0 8px rgba(255,97,0,0)}}
.has-pending{animation:pulse 2s infinite}
</style>
</head>
<body>

<h1>Shared<span>Brain</span> Sync Demo</h1>
<p class="subtitle">Multi-user CRDT synchronization with HLC causality and LWW conflict resolution</p>

<div class="controls">
  <button class="btn" onclick="storeAs('alice')">+ Store as Alice</button>
  <button class="btn btn-outline" onclick="storeAs('bob')">+ Store as Bob</button>
  <button class="btn btn-success" id="sync-btn" onclick="doSync()">Sync Now</button>
  <button class="btn btn-outline" onclick="runConflictDemo()">Conflict Demo</button>
  <button class="btn btn-danger" onclick="doReset()">Reset</button>
</div>

<div class="conflict-result" id="conflict-result"></div>

<div class="panels">
  <div class="panel panel-alice">
    <div class="panel-header">
      <div class="avatar avatar-alice">A</div>
      <div>
        <div class="panel-title">Alice's Brain</div>
        <div class="panel-meta">Node: alice-node-01</div>
      </div>
      <div class="pending-badge" id="alice-pending" style="display:none">0 pending</div>
    </div>
    <div class="panel-body" id="alice-memories">
      <div class="log-empty">Loading...</div>
    </div>
  </div>

  <div class="panel panel-bob">
    <div class="panel-header">
      <div class="avatar avatar-bob">B</div>
      <div>
        <div class="panel-title">Bob's Brain</div>
        <div class="panel-meta">Node: bob-node-02</div>
      </div>
      <div class="pending-badge" id="bob-pending" style="display:none">0 pending</div>
    </div>
    <div class="panel-body" id="bob-memories">
      <div class="log-empty">Loading...</div>
    </div>
  </div>
</div>

<div class="log-section">
  <div class="log-header">
    <h3>Sync Operation Log</h3>
    <span class="log-count" id="log-count">0</span>
  </div>
  <div class="log-body" id="sync-log">
    <div class="log-empty">No sync operations yet. Click "Sync Now" to exchange operations.</div>
  </div>
</div>

<!-- Store Modal -->
<div class="modal-overlay" id="store-modal">
  <div class="modal">
    <h3 id="modal-title">Store Memory</h3>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="m-title" placeholder="Memory title..."/>
    </div>
    <div class="form-group">
      <label>Content</label>
      <textarea id="m-content" placeholder="Memory content..."></textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Scope</label>
        <select id="m-scope">
          <option value="team">Team (syncs to others)</option>
          <option value="personal">Personal (stays local)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Tags (comma separated)</label>
        <input type="text" id="m-tags" placeholder="tag1, tag2"/>
      </div>
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn" id="modal-submit" onclick="submitStore()">Store</button>
    </div>
  </div>
</div>

<!-- Edit Modal -->
<div class="modal-overlay" id="edit-modal">
  <div class="modal">
    <h3>Edit Memory</h3>
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="e-title"/>
    </div>
    <div class="form-group">
      <label>Content</label>
      <textarea id="e-content"></textarea>
    </div>
    <div class="form-actions">
      <button class="btn btn-outline" onclick="closeEditModal()">Cancel</button>
      <button class="btn" onclick="submitEdit()">Save Changes</button>
    </div>
    <input type="hidden" id="e-user"/>
    <input type="hidden" id="e-memory-id"/>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
const API = '/api/sync-demo';
let currentStoreUser = 'alice';

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function formatHlc(hlc) {
  if (!hlc) return '';
  const parts = hlc.split(':');
  if (parts.length < 3) return hlc;
  const ms = parseInt(parts[0]);
  const counter = parts[1];
  const node = parts.slice(2).join(':');
  const time = new Date(ms).toLocaleTimeString();
  return time + ' #' + counter + ' @' + node.split('-')[0];
}

function renderMemory(m, viewerUser) {
  const isRemote = m.authorId !== (viewerUser === 'alice' ? 'alice-node-01' : 'bob-node-02');
  const originClass = isRemote
    ? (m.authorName === 'Alice' ? 'memory-remote-alice' : 'memory-remote-bob')
    : 'memory-local';
  const originBadge = isRemote
    ? '<span class="origin-badge ' + (m.authorName === 'Alice' ? 'origin-alice' : 'origin-bob') + '">from ' + esc(m.authorName) + '</span>'
    : '';
  const scopeClass = m.scope === 'team' ? 'scope-team' : 'scope-personal';

  return '<div class="memory ' + originClass + '">' +
    '<button class="edit-btn" onclick="editMemory(\\'' + viewerUser + '\\',\\'' + m.id + '\\',\\'' + esc(m.title).replace(/'/g, "\\\\'") + '\\',\\'' + esc(m.content).replace(/'/g, "\\\\'") + '\\')">Edit</button>' +
    '<div class="memory-title">' + esc(m.title) + ' ' + originBadge + '</div>' +
    '<div class="memory-content">' + esc(m.content) + '</div>' +
    '<div class="memory-meta">' +
      '<span class="memory-scope ' + scopeClass + '">' + m.scope + '</span>' +
      m.tags.map(t => '<span class="memory-tag">' + esc(t) + '</span>').join('') +
      '<span class="memory-hlc" title="Title HLC: ' + m.titleHlc + '&#10;Content HLC: ' + m.contentHlc + '">HLC: ' + formatHlc(m.titleHlc) + '</span>' +
    '</div>' +
  '</div>';
}

function renderLog(log) {
  const el = document.getElementById('sync-log');
  document.getElementById('log-count').textContent = log.length;

  if (!log.length) {
    el.innerHTML = '<div class="log-empty">No sync operations yet.</div>';
    return;
  }

  el.innerHTML = log.slice().reverse().map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    let dirClass = 'dir-system';
    let dirLabel = 'SYSTEM';
    if (entry.direction === 'alice-to-bob') { dirClass = 'dir-alice-to-bob'; dirLabel = 'A -> B'; }
    if (entry.direction === 'bob-to-alice') { dirClass = 'dir-bob-to-alice'; dirLabel = 'B -> A'; }

    let msg = esc(entry.message);
    if (msg.includes('BLOCKED')) msg = msg.replace('BLOCKED', '<span class="blocked">BLOCKED</span>');
    if (msg.includes('CONFLICT')) msg = msg.replace('CONFLICT', '<span class="conflict">CONFLICT</span>');

    return '<div class="log-entry">' +
      '<span class="log-time">' + time + '</span>' +
      '<span class="log-dir ' + dirClass + '">' + dirLabel + '</span>' +
      '<span class="log-msg">' + msg + '</span>' +
    '</div>';
  }).join('');
}

async function refresh() {
  const res = await fetch(API + '/state');
  const data = await res.json();

  // Alice's memories
  const aliceEl = document.getElementById('alice-memories');
  if (data.alice.memories.length) {
    aliceEl.innerHTML = data.alice.memories.map(m => renderMemory(m, 'alice')).join('');
  } else {
    aliceEl.innerHTML = '<div class="log-empty">No memories stored</div>';
  }

  // Bob's memories
  const bobEl = document.getElementById('bob-memories');
  if (data.bob.memories.length) {
    bobEl.innerHTML = data.bob.memories.map(m => renderMemory(m, 'bob')).join('');
  } else {
    bobEl.innerHTML = '<div class="log-empty">No memories stored</div>';
  }

  // Pending badges
  const alicePending = document.getElementById('alice-pending');
  const bobPending = document.getElementById('bob-pending');
  if (data.alice.pendingOps > 0) {
    alicePending.style.display = 'block';
    alicePending.textContent = data.alice.pendingOps + ' pending';
  } else {
    alicePending.style.display = 'none';
  }
  if (data.bob.pendingOps > 0) {
    bobPending.style.display = 'block';
    bobPending.textContent = data.bob.pendingOps + ' pending';
  } else {
    bobPending.style.display = 'none';
  }

  // Sync button pulse
  const syncBtn = document.getElementById('sync-btn');
  if (data.alice.pendingOps > 0 || data.bob.pendingOps > 0) {
    syncBtn.classList.add('has-pending');
  } else {
    syncBtn.classList.remove('has-pending');
  }

  // Log
  renderLog(data.log);
}

function storeAs(user) {
  currentStoreUser = user;
  document.getElementById('modal-title').textContent = 'Store Memory as ' + (user === 'alice' ? 'Alice' : 'Bob');
  document.getElementById('store-modal').classList.add('active');
  document.getElementById('m-title').focus();
}

function closeModal() {
  document.getElementById('store-modal').classList.remove('active');
  document.getElementById('m-title').value = '';
  document.getElementById('m-content').value = '';
  document.getElementById('m-tags').value = '';
  document.getElementById('m-scope').value = 'team';
}

async function submitStore() {
  const title = document.getElementById('m-title').value.trim();
  const content = document.getElementById('m-content').value.trim();
  const scope = document.getElementById('m-scope').value;
  const tagsRaw = document.getElementById('m-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  if (!title || !content) { toast('Title and content are required'); return; }

  await fetch(API + '/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: currentStoreUser, title, content, scope, tags }),
  });

  closeModal();
  toast((currentStoreUser === 'alice' ? 'Alice' : 'Bob') + ' stored: ' + title);
  refresh();
}

function editMemory(user, memoryId, title, content) {
  document.getElementById('e-user').value = user;
  document.getElementById('e-memory-id').value = memoryId;
  document.getElementById('e-title').value = title;
  document.getElementById('e-content').value = content;
  document.getElementById('edit-modal').classList.add('active');
  document.getElementById('e-title').focus();
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('active');
}

async function submitEdit() {
  const user = document.getElementById('e-user').value;
  const memoryId = document.getElementById('e-memory-id').value;
  const title = document.getElementById('e-title').value.trim();
  const content = document.getElementById('e-content').value.trim();

  if (!title && !content) { toast('Nothing to update'); return; }

  await fetch(API + '/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, memoryId, title: title || undefined, content: content || undefined }),
  });

  closeEditModal();
  toast('Memory updated — sync to push changes');
  refresh();
}

async function doSync() {
  const res = await fetch(API + '/sync', { method: 'POST' });
  const data = await res.json();
  toast('Synced ' + data.synced + ' ops' + (data.conflicts.length ? ' (' + data.conflicts.length + ' conflicts resolved)' : ''));
  refresh();
}

async function runConflictDemo() {
  const res = await fetch(API + '/conflict-demo', { method: 'POST' });
  const data = await res.json();

  const el = document.getElementById('conflict-result');
  el.classList.add('active');
  el.innerHTML = '<div class="conflict-title"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2L18 17H2L10 2Z" stroke="currentColor" stroke-width="2"/><path d="M10 8v4M10 14v1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Conflict Resolution Demo</div>' +
    '<p style="color:var(--muted);font-size:13px;margin-bottom:16px">Alice edited the <b>title</b>, Bob edited the <b>content</b> — on the same memory, at the same time. LWW per-field merges both changes cleanly.</p>' +
    '<div class="conflict-grid">' +
      '<div class="conflict-cell"><h4>Alice Sees</h4>' +
        '<div class="field"><div class="field-label">Title</div><div class="field-value">' + esc(data.finalState.aliceSees.title || '') + '</div><div class="field-hlc">' + formatHlc(data.finalState.aliceSees.titleHlc) + '</div></div>' +
        '<div class="field"><div class="field-label">Content</div><div class="field-value">' + esc(data.finalState.aliceSees.content || '') + '</div><div class="field-hlc">' + formatHlc(data.finalState.aliceSees.contentHlc) + '</div></div>' +
      '</div>' +
      '<div class="conflict-cell"><h4>Bob Sees</h4>' +
        '<div class="field"><div class="field-label">Title</div><div class="field-value">' + esc(data.finalState.bobSees.title || '') + '</div><div class="field-hlc">' + formatHlc(data.finalState.bobSees.titleHlc) + '</div></div>' +
        '<div class="field"><div class="field-label">Content</div><div class="field-value">' + esc(data.finalState.bobSees.content || '') + '</div><div class="field-hlc">' + formatHlc(data.finalState.bobSees.contentHlc) + '</div></div>' +
      '</div>' +
    '</div>' +
    '<p style="color:var(--success);font-size:13px;margin-top:12px;font-weight:600">Both users see identical final state — convergence achieved without data loss.</p>';

  toast('Conflict demo complete — check result above');
  refresh();
}

async function doReset() {
  await fetch(API + '/reset', { method: 'POST' });
  document.getElementById('conflict-result').classList.remove('active');
  toast('Demo reset to initial state');
  refresh();
}

// Initial load
refresh();
</script>
</body>
</html>`;
