/**
 * versioning.ts — Memory versioning system
 *
 * Tracks every edit to a memory as a new version, providing:
 * - Full history of changes
 * - Diff between any two versions
 * - Revert to previous version
 * - Audit trail (who changed what when)
 */

import type { Memory } from './mcp/handler.js';

export interface VersionEntry {
  id: string;
  memoryId: string;
  version: number;
  content: string;
  title: string | null;
  type: string;
  tagsJson: string;
  authorId: string;
  changedBy: string;
  changedAt: string;
  changeType: 'created' | 'updated' | 'deleted';
}

export class VersionManager {
  private db: any;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Initialize the memory_versions table.
   * Call this after the main schema is created.
   */
  initialize(): void {
    const schema = `
      CREATE TABLE IF NOT EXISTS memory_versions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        title TEXT,
        type TEXT,
        tags_json TEXT,
        author_id TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        changed_at TEXT NOT NULL,
        change_type TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_versions_memory_id ON memory_versions(memory_id);
      CREATE INDEX IF NOT EXISTS idx_versions_version ON memory_versions(memory_id, version);
      CREATE INDEX IF NOT EXISTS idx_versions_changed_at ON memory_versions(changed_at);
    `;

    this.db.run(schema);
    console.log('[versioning] Memory versioning system initialized.');
  }

  /**
   * Record a new version snapshot for a memory.
   * Call this after every create/update/delete operation.
   */
  recordVersion(memory: Memory, changedBy: string, changeType: 'created' | 'updated' | 'deleted'): void {
    const versionId = `ver_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const changedAt = new Date().toISOString();

    this.db.run(
      `INSERT INTO memory_versions (id, memory_id, version, content, title, type, tags_json, author_id, changed_by, changed_at, change_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        versionId,
        memory.id,
        memory.version,
        memory.content,
        memory.title,
        memory.type,
        JSON.stringify(memory.tags),
        memory.authorId,
        changedBy,
        changedAt,
        changeType,
      ]
    );
  }

  /**
   * Get the full version history for a memory.
   * Returns newest first by default.
   */
  getHistory(memoryId: string, limit: number = 50): VersionEntry[] {
    const rows = this.db.exec(
      `SELECT * FROM memory_versions WHERE memory_id = ? ORDER BY version DESC LIMIT ?`,
      [memoryId, limit]
    );

    if (!rows.length || !rows[0].values.length) return [];

    return rows[0].values.map((row: any) => {
      const cols = rows[0].columns;
      const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
      return {
        id: r.id,
        memoryId: r.memory_id,
        version: r.version,
        content: r.content,
        title: r.title ?? null,
        type: r.type,
        tagsJson: r.tags_json,
        authorId: r.author_id,
        changedBy: r.changed_by,
        changedAt: r.changed_at,
        changeType: r.change_type,
      };
    });
  }

  /**
   * Get a specific version of a memory.
   */
  getVersion(memoryId: string, version: number): VersionEntry | null {
    const rows = this.db.exec(
      'SELECT * FROM memory_versions WHERE memory_id = ? AND version = ?',
      [memoryId, version]
    );

    if (!rows.length || !rows[0].values.length) return null;

    const cols = rows[0].columns;
    const r = Object.fromEntries(cols.map((c: string, i: number) => [c, rows[0].values[0][i]])) as any;

    return {
      id: r.id,
      memoryId: r.memory_id,
      version: r.version,
      content: r.content,
      title: r.title ?? null,
      type: r.type,
      tagsJson: r.tags_json,
      authorId: r.author_id,
      changedBy: r.changed_by,
      changedAt: r.changed_at,
      changeType: r.change_type,
    };
  }

  /**
   * Compute a simple diff between two versions.
   * Returns changed fields with before/after values.
   */
  diff(memoryId: string, v1: number, v2: number): Array<{ field: string; from: string; to: string }> {
    const version1 = this.getVersion(memoryId, v1);
    const version2 = this.getVersion(memoryId, v2);

    if (!version1 || !version2) return [];

    const changes: Array<{ field: string; from: string; to: string }> = [];

    if (version1.content !== version2.content) {
      changes.push({ field: 'content', from: version1.content, to: version2.content });
    }

    if (version1.title !== version2.title) {
      changes.push({ field: 'title', from: version1.title ?? '', to: version2.title ?? '' });
    }

    if (version1.type !== version2.type) {
      changes.push({ field: 'type', from: version1.type, to: version2.type });
    }

    if (version1.tagsJson !== version2.tagsJson) {
      changes.push({ field: 'tags', from: version1.tagsJson, to: version2.tagsJson });
    }

    return changes;
  }

  /**
   * Revert a memory to a previous version.
   * Returns the version state (caller must apply it to the store).
   */
  revert(memoryId: string, version: number): VersionEntry | null {
    return this.getVersion(memoryId, version);
  }

  /**
   * Get aggregate stats about versioning.
   */
  getStats(): { totalVersions: number; memoriesWithHistory: number; avgVersionsPerMemory: number } {
    const rows = this.db.exec(`
      SELECT
        COUNT(*) as total_versions,
        COUNT(DISTINCT memory_id) as unique_memories
      FROM memory_versions
    `);

    if (!rows.length || !rows[0].values.length) {
      return { totalVersions: 0, memoriesWithHistory: 0, avgVersionsPerMemory: 0 };
    }

    const totalVersions = rows[0].values[0][0] as number;
    const uniqueMemories = rows[0].values[0][1] as number;

    return {
      totalVersions,
      memoriesWithHistory: uniqueMemories,
      avgVersionsPerMemory: uniqueMemories > 0 ? totalVersions / uniqueMemories : 0,
    };
  }
}
