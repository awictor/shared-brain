/**
 * NotificationManager — real-time notification system for team collaboration.
 *
 * Triggers:
 * - related_memory: when someone stores a memory similar to yours (score > 0.6)
 * - team_decision: when a team member stores a 'decision' type memory
 * - memory_referenced: when your memory is linked via relations
 * - milestone: when team hits memory count milestones (50/100/500)
 */

import type { Embeddings } from './mcp/handler.js';
import type { VectorIndex } from './mcp/handler.js';

export interface Notification {
  id: string;
  userId: string;
  type: 'related_memory' | 'team_decision' | 'memory_referenced' | 'milestone';
  title: string;
  body: string;
  memoryId: string | null;
  sourceUserId: string | null;
  read: boolean;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  memory_id TEXT,
  source_user_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at);
`;

export class NotificationManager {
  constructor(
    private db: any,
    private embeddings: Embeddings,
    private vectorIndex: VectorIndex,
  ) {}

  initialize(): void {
    this.db.run(SCHEMA);
    console.log('[notifications] Notification system initialized.');
  }

  /**
   * Create a new notification for a user.
   */
  notify(
    userId: string,
    type: Notification['type'],
    title: string,
    body: string,
    memoryId?: string,
    sourceUserId?: string,
  ): void {
    const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO notifications (id, user_id, type, title, body, memory_id, source_user_id, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, userId, type, title, body, memoryId ?? null, sourceUserId ?? null, now],
    );

    console.log(`[notifications] Created ${type} notification for ${userId}: ${title}`);
  }

  /**
   * Get all unread notifications for a user.
   */
  getUnread(userId: string): Notification[] {
    const rows = this.db.exec(
      'SELECT * FROM notifications WHERE user_id = ? AND read = 0 ORDER BY created_at DESC',
      [userId],
    );

    if (!rows.length || !rows[0].values.length) return [];

    return rows[0].values.map((row: any) => this.rowToNotification(rows[0].columns, row));
  }

  /**
   * Get all notifications (read and unread) for a user.
   */
  getAll(userId: string, limit = 50): Notification[] {
    const rows = this.db.exec(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [userId, limit],
    );

    if (!rows.length || !rows[0].values.length) return [];

    return rows[0].values.map((row: any) => this.rowToNotification(rows[0].columns, row));
  }

  /**
   * Mark a single notification as read.
   */
  markRead(notificationId: string): void {
    this.db.run('UPDATE notifications SET read = 1 WHERE id = ?', [notificationId]);
  }

  /**
   * Mark all unread notifications as read for a user.
   */
  markAllRead(userId: string): void {
    this.db.run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', [userId]);
  }

  /**
   * Get unread notification count for a user.
   */
  getCount(userId: string): number {
    const rows = this.db.exec(
      'SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read = 0',
      [userId],
    );
    return rows[0]?.values[0]?.[0] as number ?? 0;
  }

  /**
   * Check if a newly stored memory is similar to any existing memory by another user.
   * If so, notify the original author.
   */
  async checkRelatedMemory(
    newMemoryId: string,
    newMemoryContent: string,
    newMemoryAuthorId: string,
    newMemoryAuthorName: string,
    embedding: Float32Array,
  ): Promise<void> {
    // Search for similar memories (excluding self)
    const candidates = this.vectorIndex.search(embedding, 10, 0.6);

    for (const candidate of candidates) {
      if (candidate.id === newMemoryId) continue; // Skip self

      // Get the original memory
      const rows = this.db.exec('SELECT author_id FROM memories WHERE id = ? AND deleted = 0', [candidate.id]);
      if (!rows.length || !rows[0].values.length) continue;

      const originalAuthorId = rows[0].values[0][0] as string;

      // Only notify if different author
      if (originalAuthorId !== newMemoryAuthorId && originalAuthorId !== 'anonymous') {
        const title = `Related memory from ${newMemoryAuthorName}`;
        const preview = newMemoryContent.slice(0, 100) + (newMemoryContent.length > 100 ? '...' : '');
        const body = `${newMemoryAuthorName} stored a memory similar to yours (${Math.round(candidate.score * 100)}% match): "${preview}"`;

        this.notify(originalAuthorId, 'related_memory', title, body, newMemoryId, newMemoryAuthorId);
      }
    }
  }

  /**
   * Check if a memory references another user's memory via relations.
   * Notify the referenced memory's author.
   */
  async checkMemoryReferenced(
    newMemoryId: string,
    newMemoryAuthorId: string,
    newMemoryAuthorName: string,
    relations: Array<{ targetId: string; type: string }>,
  ): Promise<void> {
    for (const relation of relations) {
      const rows = this.db.exec(
        'SELECT author_id, content FROM memories WHERE id = ? AND deleted = 0',
        [relation.targetId],
      );

      if (!rows.length || !rows[0].values.length) continue;

      const targetAuthorId = rows[0].values[0][0] as string;

      if (targetAuthorId !== newMemoryAuthorId && targetAuthorId !== 'anonymous') {
        const title = `Your memory was referenced by ${newMemoryAuthorName}`;
        const body = `${newMemoryAuthorName} linked their memory to yours (${relation.type}).`;

        this.notify(targetAuthorId, 'memory_referenced', title, body, newMemoryId, newMemoryAuthorId);
      }
    }
  }

  /**
   * Check if team hit a milestone (50/100/500 memories) and notify all members.
   */
  async checkMilestone(): Promise<void> {
    const rows = this.db.exec('SELECT COUNT(*) FROM memories WHERE deleted = 0');
    const totalCount = rows[0]?.values[0]?.[0] as number ?? 0;

    const milestones = [50, 100, 500];
    const previousCount = totalCount - 1; // Before this memory was added

    for (const milestone of milestones) {
      if (previousCount < milestone && totalCount >= milestone) {
        // Hit milestone! Notify all users
        const userRows = this.db.exec('SELECT DISTINCT author_id FROM memories WHERE deleted = 0 AND author_id != ?', ['anonymous']);
        if (!userRows.length || !userRows[0].values.length) continue;

        for (const userRow of userRows[0].values) {
          const userId = userRow[0] as string;
          const title = `Milestone: ${milestone} memories!`;
          const body = `Your team has collectively stored ${totalCount} memories. Keep building the shared brain!`;

          this.notify(userId, 'milestone', title, body);
        }
      }
    }
  }

  /**
   * Check if a team member stored a 'decision' type memory and notify all team members.
   */
  async checkTeamDecision(
    newMemoryId: string,
    newMemoryAuthorId: string,
    newMemoryAuthorName: string,
    memoryType: string,
    memoryContent: string,
  ): Promise<void> {
    if (memoryType !== 'decision') return;

    // Notify all users except the author
    const rows = this.db.exec(
      'SELECT DISTINCT author_id FROM memories WHERE deleted = 0 AND author_id != ? AND author_id != ?',
      [newMemoryAuthorId, 'anonymous'],
    );

    if (!rows.length || !rows[0].values.length) return;

    for (const row of rows[0].values) {
      const userId = row[0] as string;
      const title = `Team decision by ${newMemoryAuthorName}`;
      const preview = memoryContent.slice(0, 100) + (memoryContent.length > 100 ? '...' : '');
      const body = `${newMemoryAuthorName} recorded a decision: "${preview}"`;

      this.notify(userId, 'team_decision', title, body, newMemoryId, newMemoryAuthorId);
    }
  }

  private rowToNotification(columns: string[], row: any): Notification {
    const r = Object.fromEntries(columns.map((c, i) => [c, row[i]])) as any;
    return {
      id: r.id,
      userId: r.user_id,
      type: r.type,
      title: r.title,
      body: r.body,
      memoryId: r.memory_id ?? null,
      sourceUserId: r.source_user_id ?? null,
      read: r.read === 1,
      createdAt: r.created_at,
    };
  }
}
