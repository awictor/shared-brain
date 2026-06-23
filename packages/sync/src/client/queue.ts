/**
 * OfflineQueue — persists unsynced operations in the local SQLite database.
 *
 * When the client is offline, operations are enqueued locally. Once connectivity
 * is restored, the SyncClient drains this queue and pushes ops to the relay.
 *
 * Operations are stored in the existing `operations` table with `synced=0`.
 * This class provides a focused interface over that table for the sync layer.
 */

import type { MemoryOperation } from '@shared-brain/core';

/**
 * Interface for the SQLite database handle used by the queue.
 * Compatible with better-sqlite3's Database API.
 */
export interface QueueDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

export class OfflineQueue {
  private db: QueueDatabase;

  constructor(db: QueueDatabase) {
    this.db = db;
  }

  /**
   * Append an operation to the offline queue (synced=0).
   */
  async enqueue(op: MemoryOperation): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO operations (id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id, synced, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    stmt.run(
      op.id,
      op.memoryId,
      op.hlc,
      op.authorId,
      op.type,
      JSON.stringify(op.payload),
      op.scope,
      op.teamId ?? null,
      op.orgId ?? null,
      new Date().toISOString(),
    );
  }

  /**
   * Get all pending (unsynced) operations, ordered by HLC ascending.
   */
  async pending(): Promise<MemoryOperation[]> {
    const stmt = this.db.prepare(`
      SELECT id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id
      FROM operations
      WHERE synced = 0
      ORDER BY hlc ASC
    `);

    const rows = stmt.all() as Array<{
      id: string;
      memory_id: string;
      hlc: string;
      author_id: string;
      type: string;
      payload_json: string;
      scope: string;
      team_id: string | null;
      org_id: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      memoryId: row.memory_id,
      hlc: row.hlc,
      authorId: row.author_id,
      type: row.type as MemoryOperation['type'],
      payload: JSON.parse(row.payload_json),
      scope: row.scope as MemoryOperation['scope'],
      teamId: row.team_id,
      orgId: row.org_id,
    }));
  }

  /**
   * Mark operations as synced (synced=1) by their IDs.
   */
  async acknowledge(opIds: string[]): Promise<void> {
    if (opIds.length === 0) return;

    // Use a transaction for batch efficiency
    const placeholders = opIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      UPDATE operations SET synced = 1 WHERE id IN (${placeholders})
    `);

    stmt.run(...opIds);
  }

  /**
   * Count of pending (unsynced) operations.
   */
  async size(): Promise<number> {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM operations WHERE synced = 0
    `);

    const row = stmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }
}
