/**
 * Cross-Agent Identity System for SharedBrain
 *
 * Enables multiple AI agents (Claude Code, Cursor, ChatGPT, etc.) to share
 * the same brain with proper attribution and session tracking.
 */

import { randomUUID } from 'crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentIdentity {
  id: string;
  name: string;
  userId: string;
  deviceId: string;
  firstSeen: string;
  lastSeen: string;
  memoriesCreated: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  agents: AgentIdentity[];
  createdAt: string;
}

export interface CrossAgentActivity {
  agentId: string;
  agentName: string;
  userId: string;
  action: string;
  memoryId?: string;
  memoryTitle?: string;
  timestamp: string;
}

// ─── Identity Manager ───────────────────────────────────────────────────────

const IDENTITY_SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL DEFAULT 'unknown',
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  memories_created INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_activity (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  action TEXT NOT NULL,
  memory_id TEXT,
  memory_title TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen);
CREATE INDEX IF NOT EXISTS idx_activity_agent ON agent_activity(agent_id);
CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON agent_activity(timestamp);
`;

export class IdentityManager {
  private db: any;
  private initialized = false;

  constructor(db: any) {
    this.db = db;
  }

  /**
   * Create identity tables in the database.
   */
  initialize(): void {
    if (this.initialized) return;
    this.db.run(IDENTITY_SCHEMA);
    this.initialized = true;
    console.log('[identity] Identity tables initialized.');
  }

  /**
   * Register a new agent or return existing one if name+userId+deviceId match.
   */
  registerAgent(name: string, userId?: string, deviceId?: string): AgentIdentity {
    const resolvedUserId = userId ?? 'default';
    const resolvedDeviceId = deviceId ?? this.getDefaultDeviceId();

    // Check if agent already exists with same name + user + device
    const existing = this.findAgent(name, resolvedUserId, resolvedDeviceId);
    if (existing) {
      // Update last_seen
      this.db.run(
        'UPDATE agents SET last_seen = ? WHERE id = ?',
        [new Date().toISOString(), existing.id],
      );
      existing.lastSeen = new Date().toISOString();
      return existing;
    }

    // Ensure user exists
    this.getOrCreateUser(resolvedUserId);

    const now = new Date().toISOString();
    const agent: AgentIdentity = {
      id: randomUUID(),
      name,
      userId: resolvedUserId,
      deviceId: resolvedDeviceId,
      firstSeen: now,
      lastSeen: now,
      memoriesCreated: 0,
    };

    this.db.run(
      `INSERT INTO agents (id, name, user_id, device_id, first_seen, last_seen, memories_created)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [agent.id, agent.name, agent.userId, agent.deviceId, agent.firstSeen, agent.lastSeen, agent.memoriesCreated],
    );

    this.recordActivityEntry(agent.id, 'registered');
    console.log(`[identity] Registered agent: ${name} (${agent.id}) for user ${resolvedUserId}`);
    return agent;
  }

  /**
   * Get an agent by its ID.
   */
  getAgent(id: string): AgentIdentity | null {
    const rows = this.db.exec('SELECT * FROM agents WHERE id = ?', [id]);
    if (!rows.length || !rows[0].values.length) return null;
    return this.rowToAgent(rows[0].columns, rows[0].values[0]);
  }

  /**
   * Get the first agent matching a given name.
   */
  getAgentByName(name: string): AgentIdentity | null {
    const rows = this.db.exec('SELECT * FROM agents WHERE name = ? ORDER BY last_seen DESC LIMIT 1', [name]);
    if (!rows.length || !rows[0].values.length) return null;
    return this.rowToAgent(rows[0].columns, rows[0].values[0]);
  }

  /**
   * Get a user profile with all associated agents.
   */
  getUserProfile(userId: string): UserProfile | null {
    const userRows = this.db.exec('SELECT * FROM users WHERE id = ?', [userId]);
    if (!userRows.length || !userRows[0].values.length) return null;

    const userCols = userRows[0].columns;
    const userRow = userRows[0].values[0];
    const u = Object.fromEntries(userCols.map((c: string, i: number) => [c, userRow[i]])) as any;

    const agentRows = this.db.exec('SELECT * FROM agents WHERE user_id = ? ORDER BY last_seen DESC', [userId]);
    const agents: AgentIdentity[] = [];
    if (agentRows.length && agentRows[0].values.length) {
      for (const row of agentRows[0].values) {
        agents.push(this.rowToAgent(agentRows[0].columns, row));
      }
    }

    return {
      id: u.id,
      name: u.name,
      email: u.email ?? undefined,
      agents,
      createdAt: u.created_at,
    };
  }

  /**
   * Get or create a user profile.
   */
  getOrCreateUser(name: string, email?: string): UserProfile {
    // Check if user exists by name
    const existing = this.db.exec('SELECT * FROM users WHERE id = ? OR name = ?', [name, name]);
    if (existing.length && existing[0].values.length) {
      const cols = existing[0].columns;
      const row = existing[0].values[0];
      const u = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
      return this.getUserProfile(u.id)!;
    }

    const user: UserProfile = {
      id: name, // Use name as ID for simplicity
      name,
      email,
      agents: [],
      createdAt: new Date().toISOString(),
    };

    this.db.run(
      'INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)',
      [user.id, user.name, user.email ?? null, user.createdAt],
    );

    console.log(`[identity] Created user: ${name}`);
    return user;
  }

  /**
   * Record activity for an agent (updates last_seen timestamp).
   */
  recordActivity(agentId: string): void {
    const now = new Date().toISOString();
    this.db.run('UPDATE agents SET last_seen = ? WHERE id = ?', [now, agentId]);
  }

  /**
   * Increment the memory count for an agent and log the activity.
   */
  recordMemoryCreated(agentId: string, memoryId: string, memoryTitle?: string): void {
    const now = new Date().toISOString();
    this.db.run(
      'UPDATE agents SET last_seen = ?, memories_created = memories_created + 1 WHERE id = ?',
      [now, agentId],
    );
    this.recordActivityEntry(agentId, 'memory_created', memoryId, memoryTitle);
  }

  /**
   * Get all agents active in the last 5 minutes.
   */
  getActiveAgents(): AgentIdentity[] {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const rows = this.db.exec(
      'SELECT * FROM agents WHERE last_seen >= ? ORDER BY last_seen DESC',
      [fiveMinAgo],
    );
    if (!rows.length || !rows[0].values.length) return [];
    return rows[0].values.map((row: any) => this.rowToAgent(rows[0].columns, row));
  }

  /**
   * Get all registered agents (not just active).
   */
  getAllAgents(): AgentIdentity[] {
    const rows = this.db.exec('SELECT * FROM agents ORDER BY last_seen DESC');
    if (!rows.length || !rows[0].values.length) return [];
    return rows[0].values.map((row: any) => this.rowToAgent(rows[0].columns, row));
  }

  /**
   * Get recent activity from other agents (cross-agent context).
   * Useful for "checkin" — see what other agents have been doing.
   */
  getRecentCrossAgentActivity(excludeAgentId: string, limit: number = 5): CrossAgentActivity[] {
    const rows = this.db.exec(
      `SELECT a.id, a.agent_id, a.action, a.memory_id, a.memory_title, a.timestamp,
              ag.name as agent_name, ag.user_id
       FROM agent_activity a
       JOIN agents ag ON a.agent_id = ag.id
       WHERE a.agent_id != ?
       ORDER BY a.timestamp DESC
       LIMIT ?`,
      [excludeAgentId, limit],
    );

    if (!rows.length || !rows[0].values.length) return [];

    return rows[0].values.map((row: any[]) => {
      const cols = rows[0].columns;
      const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
      return {
        agentId: r.agent_id,
        agentName: r.agent_name,
        userId: r.user_id,
        action: r.action,
        memoryId: r.memory_id ?? undefined,
        memoryTitle: r.memory_title ?? undefined,
        timestamp: r.timestamp,
      };
    });
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private findAgent(name: string, userId: string, deviceId: string): AgentIdentity | null {
    const rows = this.db.exec(
      'SELECT * FROM agents WHERE name = ? AND user_id = ? AND device_id = ?',
      [name, userId, deviceId],
    );
    if (!rows.length || !rows[0].values.length) return null;
    return this.rowToAgent(rows[0].columns, rows[0].values[0]);
  }

  private recordActivityEntry(agentId: string, action: string, memoryId?: string, memoryTitle?: string): void {
    this.db.run(
      `INSERT INTO agent_activity (id, agent_id, action, memory_id, memory_title, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), agentId, action, memoryId ?? null, memoryTitle ?? null, new Date().toISOString()],
    );
  }

  private rowToAgent(columns: string[], row: any[]): AgentIdentity {
    const r = Object.fromEntries(columns.map((c: string, i: number) => [c, row[i]])) as any;
    return {
      id: r.id,
      name: r.name,
      userId: r.user_id,
      deviceId: r.device_id,
      firstSeen: r.first_seen,
      lastSeen: r.last_seen,
      memoriesCreated: r.memories_created,
    };
  }

  private getDefaultDeviceId(): string {
    return `${process.platform}-${process.env['COMPUTERNAME'] ?? process.env['HOSTNAME'] ?? 'unknown'}`;
  }
}
