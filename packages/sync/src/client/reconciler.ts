/**
 * Reconciler — applies remote operations to the local store, handling
 * CRDT merge logic for conflict resolution.
 *
 * - LWW (Last-Writer-Wins) merge for scalar fields based on HLC comparison
 * - OR-Set merge for tag add/remove operations
 * - Triggers embedding recomputation when content changes
 */

import type { MemoryOperation } from '@shared-brain/core';

/**
 * Interface for the local memory store.
 * Represents the subset of SqliteStore needed by the reconciler.
 */
export interface ReconcilerStore {
  getMemory(id: string): MemoryRecord | null;
  upsertMemory(memory: MemoryRecord): void;
  addTag(memoryId: string, tag: string, dot: string): void;
  removeTag(memoryId: string, tag: string, dot: string): void;
  storeOperation(op: MemoryOperation): void;
}

/**
 * Minimal memory record interface for reconciliation.
 */
export interface MemoryRecord {
  id: string;
  content: string;
  title: string | null;
  type: string;
  scope: string;
  teamId: string | null;
  orgId: string | null;
  authorId: string;
  authorName: string;
  deleted: boolean;
  hlc: string;
  sourceJson: string | null;
  relationsJson: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/**
 * Interface for embedding engine (recompute on content change).
 */
export interface ReconcilerEmbeddings {
  embed(text: string): Promise<Float32Array>;
}

/**
 * Callback for when embedding needs to be stored.
 */
export interface EmbeddingStore {
  storeEmbedding(memoryId: string, embedding: Float32Array): void;
}

/**
 * Compare two HLC strings. Returns negative if a < b, 0 if equal, positive if a > b.
 * HLC format: "{wallMs}:{counter}:{nodeId}"
 */
function compareHLC(a: string, b: string): number {
  const [aMs, aCounter, aNode] = a.split(':');
  const [bMs, bCounter, bNode] = b.split(':');

  const msDiff = parseInt(aMs, 10) - parseInt(bMs, 10);
  if (msDiff !== 0) return msDiff;

  const counterDiff = parseInt(aCounter, 16) - parseInt(bCounter, 16);
  if (counterDiff !== 0) return counterDiff;

  return aNode < bNode ? -1 : aNode > bNode ? 1 : 0;
}

export class Reconciler {
  private store: ReconcilerStore;
  private embeddings: ReconcilerEmbeddings;
  private embeddingStore: EmbeddingStore;

  constructor(
    store: ReconcilerStore,
    embeddings: ReconcilerEmbeddings,
    embeddingStore: EmbeddingStore,
  ) {
    this.store = store;
    this.embeddings = embeddings;
    this.embeddingStore = embeddingStore;
  }

  /**
   * Apply a batch of remote operations to the local store.
   * Operations are processed in HLC order for deterministic convergence.
   *
   * Returns the list of memory IDs that had content changes (need re-embedding).
   */
  async applyRemoteOps(ops: MemoryOperation[]): Promise<string[]> {
    // Sort by HLC for deterministic application order
    const sorted = [...ops].sort((a, b) => compareHLC(a.hlc, b.hlc));
    const contentChanged = new Set<string>();

    for (const op of sorted) {
      await this.applyOp(op, contentChanged);
      // Store the operation in the local op log
      this.store.storeOperation(op);
    }

    // Recompute embeddings for all memories with content changes
    const changedIds = Array.from(contentChanged);
    for (const memoryId of changedIds) {
      const memory = this.store.getMemory(memoryId);
      if (memory && !memory.deleted) {
        const embedding = await this.embeddings.embed(memory.content);
        this.embeddingStore.storeEmbedding(memoryId, embedding);
      }
    }

    return changedIds;
  }

  /**
   * Apply a single operation using the appropriate CRDT merge strategy.
   */
  private async applyOp(op: MemoryOperation, contentChanged: Set<string>): Promise<void> {
    switch (op.type) {
      case 'create':
        this.applyCreate(op, contentChanged);
        break;
      case 'update':
        this.applyUpdate(op, contentChanged);
        break;
      case 'delete':
        this.applyDelete(op);
        break;
      case 'tag_add':
        this.applyTagAdd(op);
        break;
      case 'tag_remove':
        this.applyTagRemove(op);
        break;
    }
  }

  /**
   * Apply a create operation. If the memory already exists (concurrent create),
   * merge using LWW on each field.
   */
  private applyCreate(op: MemoryOperation, contentChanged: Set<string>): void {
    const existing = this.store.getMemory(op.memoryId);
    const payload = op.payload as Record<string, unknown>;

    if (!existing) {
      // Simple case: memory doesn't exist locally yet
      const memory: MemoryRecord = {
        id: op.memoryId,
        content: (payload.content as string) ?? '',
        title: (payload.title as string) ?? null,
        type: (payload.type as string) ?? 'fact',
        scope: op.scope,
        teamId: op.teamId,
        orgId: op.orgId,
        authorId: op.authorId,
        authorName: (payload.authorName as string) ?? 'Unknown',
        deleted: false,
        hlc: op.hlc,
        sourceJson: payload.source ? JSON.stringify(payload.source) : null,
        relationsJson: payload.relations ? JSON.stringify(payload.relations) : null,
        createdAt: (payload.createdAt as string) ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };

      this.store.upsertMemory(memory);
      contentChanged.add(op.memoryId);
    } else {
      // Concurrent create — merge via LWW per field
      this.mergeFields(existing, op, contentChanged);
    }
  }

  /**
   * Apply an update operation using LWW per-field merge.
   */
  private applyUpdate(op: MemoryOperation, contentChanged: Set<string>): void {
    const existing = this.store.getMemory(op.memoryId);
    if (!existing) {
      // We received an update for a memory we don't have yet.
      // This can happen if operations arrive out of order.
      // Create a skeleton record — the create op will fill it in later.
      const payload = op.payload as Record<string, unknown>;
      const memory: MemoryRecord = {
        id: op.memoryId,
        content: (payload.content as string) ?? '',
        title: (payload.title as string) ?? null,
        type: (payload.type as string) ?? 'fact',
        scope: op.scope,
        teamId: op.teamId,
        orgId: op.orgId,
        authorId: op.authorId,
        authorName: (payload.authorName as string) ?? 'Unknown',
        deleted: false,
        hlc: op.hlc,
        sourceJson: null,
        relationsJson: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      this.store.upsertMemory(memory);
      if (payload.content) {
        contentChanged.add(op.memoryId);
      }
      return;
    }

    this.mergeFields(existing, op, contentChanged);
  }

  /**
   * Apply a delete operation. Delete wins if its HLC is >= the record's HLC.
   * (Soft-delete: sets deleted=true)
   */
  private applyDelete(op: MemoryOperation): void {
    const existing = this.store.getMemory(op.memoryId);
    if (!existing) return;

    // LWW: if the delete's HLC is newer, apply it
    if (compareHLC(op.hlc, existing.hlc) >= 0) {
      existing.deleted = true;
      existing.hlc = op.hlc;
      existing.updatedAt = new Date().toISOString();
      existing.version += 1;
      this.store.upsertMemory(existing);
    }
  }

  /**
   * Apply a tag_add operation using OR-Set semantics.
   * Each add introduces a new "dot" (the op's HLC). The tag is present
   * if it has at least one un-removed dot.
   */
  private applyTagAdd(op: MemoryOperation): void {
    const payload = op.payload as { tag?: string };
    if (!payload.tag) return;

    this.store.addTag(op.memoryId, payload.tag, op.hlc);
  }

  /**
   * Apply a tag_remove operation using OR-Set semantics.
   * Removes only the dots that were observed at the time of removal.
   * The `payload.dots` field lists the observed dots to remove.
   */
  private applyTagRemove(op: MemoryOperation): void {
    const payload = op.payload as { tag?: string; dots?: string[] };
    if (!payload.tag) return;

    // If specific dots are listed, remove those. Otherwise, use the op's HLC
    // as the single dot to mark removed.
    const dots = payload.dots ?? [op.hlc];
    for (const dot of dots) {
      this.store.removeTag(op.memoryId, payload.tag, dot);
    }
  }

  /**
   * Merge individual fields from an operation into an existing memory record
   * using Last-Writer-Wins: the higher HLC wins for each field.
   */
  private mergeFields(
    existing: MemoryRecord,
    op: MemoryOperation,
    contentChanged: Set<string>,
  ): void {
    const payload = op.payload as Record<string, unknown>;
    let changed = false;

    // Only apply if the operation's HLC is newer than the record's
    if (compareHLC(op.hlc, existing.hlc) > 0) {
      if (payload.content !== undefined && payload.content !== existing.content) {
        existing.content = payload.content as string;
        contentChanged.add(op.memoryId);
        changed = true;
      }
      if (payload.title !== undefined) {
        existing.title = payload.title as string | null;
        changed = true;
      }
      if (payload.type !== undefined) {
        existing.type = payload.type as string;
        changed = true;
      }
      if (payload.scope !== undefined) {
        existing.scope = payload.scope as string;
        changed = true;
      }
      if (payload.teamId !== undefined) {
        existing.teamId = payload.teamId as string | null;
        changed = true;
      }
      if (payload.orgId !== undefined) {
        existing.orgId = payload.orgId as string | null;
        changed = true;
      }
      if (payload.relations !== undefined) {
        existing.relationsJson = JSON.stringify(payload.relations);
        changed = true;
      }

      if (changed) {
        existing.hlc = op.hlc;
        existing.updatedAt = new Date().toISOString();
        existing.version += 1;
        this.store.upsertMemory(existing);
      }
    }
  }
}
