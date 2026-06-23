/**
 * RelayPersistence — PostgreSQL-backed persistence layer for the relay server.
 *
 * Stores all operations that flow through the relay for:
 * - Historical sync (new clients catching up)
 * - Merkle tree reconstruction
 * - Audit trail
 */

import pg from 'pg';
import type { MemoryOperation, MemoryScope } from '@shared-brain/core';

const { Pool } = pg;

export interface RelayPersistenceConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections?: number;
}

export class RelayPersistence {
  private pool: pg.Pool;

  constructor(config: RelayPersistenceConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections ?? 20,
    });
  }

  /**
   * Initialize the database schema (create tables if they don't exist).
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS operations (
          id UUID PRIMARY KEY,
          memory_id UUID NOT NULL,
          hlc VARCHAR(100) NOT NULL,
          author_id UUID NOT NULL,
          type VARCHAR(20) NOT NULL,
          payload_json JSONB NOT NULL,
          scope VARCHAR(20) NOT NULL,
          team_id UUID,
          org_id UUID,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_operations_hlc ON operations(hlc);
        CREATE INDEX IF NOT EXISTS idx_operations_scope ON operations(scope, team_id, org_id);
        CREATE INDEX IF NOT EXISTS idx_operations_memory_id ON operations(memory_id);
        CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at);
      `);
    } finally {
      client.release();
    }
  }

  /**
   * Store a single operation in the relay database.
   */
  async storeOp(op: MemoryOperation): Promise<void> {
    await this.pool.query(
      `INSERT INTO operations (id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        op.id,
        op.memoryId,
        op.hlc,
        op.authorId,
        op.type,
        JSON.stringify(op.payload),
        op.scope,
        op.teamId ?? null,
        op.orgId ?? null,
      ],
    );
  }

  /**
   * Store multiple operations in a single transaction.
   */
  async storeOps(ops: MemoryOperation[]): Promise<void> {
    if (ops.length === 0) return;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const op of ops) {
        await client.query(
          `INSERT INTO operations (id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            op.id,
            op.memoryId,
            op.hlc,
            op.authorId,
            op.type,
            JSON.stringify(op.payload),
            op.scope,
            op.teamId ?? null,
            op.orgId ?? null,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get all operations after a given HLC for the specified scopes.
   * Used for incremental sync when Merkle diff isn't needed.
   *
   * @param hlc - The HLC to start from (exclusive)
   * @param scopes - Filter by scope/team/org
   * @param limit - Max operations to return (default 1000)
   */
  async getOpsSince(
    hlc: string,
    scopes: { personal?: string; teamIds?: string[]; orgId?: string },
    limit: number = 1000,
  ): Promise<MemoryOperation[]> {
    const conditions: string[] = ['hlc > $1'];
    const params: unknown[] = [hlc];
    let paramIndex = 2;

    const scopeConditions = this.buildScopeConditions(scopes, paramIndex);
    if (scopeConditions.conditions.length > 0) {
      conditions.push(`(${scopeConditions.conditions.join(' OR ')})`);
      params.push(...scopeConditions.params);
      paramIndex = scopeConditions.nextIndex;
    }

    params.push(limit);

    const query = `
      SELECT id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id
      FROM operations
      WHERE ${conditions.join(' AND ')}
      ORDER BY hlc ASC
      LIMIT $${paramIndex}
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map(this.rowToOperation);
  }

  /**
   * Get operations in specific time buckets for the specified scopes.
   * Used during Merkle tree sync to exchange divergent buckets.
   *
   * @param buckets - Array of time bucket keys (e.g. "2024-01-15T14:00")
   * @param scopes - Filter by scope/team/org
   */
  async getOpsForBuckets(
    buckets: string[],
    scopes: { personal?: string; teamIds?: string[]; orgId?: string },
  ): Promise<MemoryOperation[]> {
    if (buckets.length === 0) return [];

    // Convert bucket keys to time ranges
    const timeConditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const bucket of buckets) {
      // Bucket format: "YYYY-MM-DDTHH:00"
      // Convert to a range: bucket start ≤ created_at < bucket start + 1 hour
      const start = new Date(`${bucket}:00Z`);
      const end = new Date(start.getTime() + 3600000); // +1 hour

      timeConditions.push(`(created_at >= $${paramIndex} AND created_at < $${paramIndex + 1})`);
      params.push(start.toISOString(), end.toISOString());
      paramIndex += 2;
    }

    const conditions: string[] = [`(${timeConditions.join(' OR ')})`];

    const scopeConditions = this.buildScopeConditions(scopes, paramIndex);
    if (scopeConditions.conditions.length > 0) {
      conditions.push(`(${scopeConditions.conditions.join(' OR ')})`);
      params.push(...scopeConditions.params);
    }

    const query = `
      SELECT id, memory_id, hlc, author_id, type, payload_json, scope, team_id, org_id
      FROM operations
      WHERE ${conditions.join(' AND ')}
      ORDER BY hlc ASC
    `;

    const result = await this.pool.query(query, params);
    return result.rows.map(this.rowToOperation);
  }

  /**
   * Get all operation IDs grouped by time bucket for Merkle tree construction.
   * Used by the relay to build its own Merkle tree for comparison with clients.
   */
  async getOpIdsByBucket(
    scopes: { personal?: string; teamIds?: string[]; orgId?: string },
  ): Promise<Map<string, string[]>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    const scopeConditions = this.buildScopeConditions(scopes, paramIndex);
    if (scopeConditions.conditions.length > 0) {
      conditions.push(`(${scopeConditions.conditions.join(' OR ')})`);
      params.push(...scopeConditions.params);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT id, hlc
      FROM operations
      ${whereClause}
      ORDER BY hlc ASC
    `;

    const result = await this.pool.query(query, params);
    const bucketMap = new Map<string, string[]>();

    for (const row of result.rows) {
      const wallMs = parseInt(row.hlc.split(':')[0], 10);
      const date = new Date(wallMs);
      const bucket = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:00`;

      let ids = bucketMap.get(bucket);
      if (!ids) {
        ids = [];
        bucketMap.set(bucket, ids);
      }
      ids.push(row.id);
    }

    return bucketMap;
  }

  /**
   * Close the database connection pool.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildScopeConditions(
    scopes: { personal?: string; teamIds?: string[]; orgId?: string },
    startIndex: number,
  ): { conditions: string[]; params: unknown[]; nextIndex: number } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = startIndex;

    if (scopes.personal) {
      conditions.push(`(scope = 'personal' AND author_id = $${idx})`);
      params.push(scopes.personal);
      idx++;
    }

    if (scopes.teamIds && scopes.teamIds.length > 0) {
      const placeholders = scopes.teamIds.map(() => `$${idx++}`).join(',');
      conditions.push(`(scope = 'team' AND team_id IN (${placeholders}))`);
      params.push(...scopes.teamIds);
    }

    if (scopes.orgId) {
      conditions.push(`(scope = 'org' AND org_id = $${idx})`);
      params.push(scopes.orgId);
      idx++;
    }

    return { conditions, params, nextIndex: idx };
  }

  private rowToOperation(row: {
    id: string;
    memory_id: string;
    hlc: string;
    author_id: string;
    type: string;
    payload_json: unknown;
    scope: string;
    team_id: string | null;
    org_id: string | null;
  }): MemoryOperation {
    return {
      id: row.id,
      memoryId: row.memory_id,
      hlc: row.hlc,
      authorId: row.author_id,
      type: row.type as MemoryOperation['type'],
      payload: (typeof row.payload_json === 'string'
        ? JSON.parse(row.payload_json)
        : row.payload_json) as Record<string, unknown>,
      scope: row.scope as MemoryScope,
      teamId: row.team_id,
      orgId: row.org_id,
    };
  }
}
