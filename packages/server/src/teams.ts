import type { Application, Request, Response } from 'express';
import { randomBytes } from 'crypto';

export interface Team {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  userId: string;
  userName: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export class TeamManager {
  constructor(private db: any) {}

  initialize(): void {
    // Create teams table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        join_code TEXT NOT NULL UNIQUE,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);

    // Create team_members table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS team_members (
        team_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TEXT NOT NULL,
        PRIMARY KEY (team_id, user_id),
        FOREIGN KEY (team_id) REFERENCES teams(id)
      );
    `);

    // Create indexes
    this.db.run('CREATE INDEX IF NOT EXISTS idx_teams_join_code ON teams(join_code);');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);');

    console.log('[teams] Team management tables initialized');
  }

  createTeam(name: string, creatorId: string): { id: string; name: string; joinCode: string } {
    const id = `team_${randomBytes(8).toString('hex')}`;
    const joinCode = this.generateJoinCode(id);
    const createdAt = new Date().toISOString();

    this.db.run(
      'INSERT INTO teams (id, name, join_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, joinCode, creatorId, createdAt]
    );

    // Add creator as admin
    this.db.run(
      'INSERT INTO team_members (team_id, user_id, user_name, role, joined_at) VALUES (?, ?, ?, ?, ?)',
      [id, creatorId, creatorId, 'admin', createdAt]
    );

    console.log(`[teams] Created team: ${name} (${id}), creator: ${creatorId}`);
    return { id, name, joinCode };
  }

  joinTeam(joinCode: string, userId: string, userName: string): { teamId: string; teamName: string } {
    // Find team by join code
    const rows = this.db.exec('SELECT id, name FROM teams WHERE join_code = ?', [joinCode]);
    if (!rows.length || !rows[0].values.length) {
      throw new Error('Invalid join code');
    }

    const teamId = rows[0].values[0][0] as string;
    const teamName = rows[0].values[0][1] as string;

    // Check if already a member
    const existingRows = this.db.exec(
      'SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );
    if (existingRows.length && existingRows[0].values.length) {
      throw new Error('Already a member of this team');
    }

    // Add as member
    const joinedAt = new Date().toISOString();
    this.db.run(
      'INSERT INTO team_members (team_id, user_id, user_name, role, joined_at) VALUES (?, ?, ?, ?, ?)',
      [teamId, userId, userName, 'member', joinedAt]
    );

    console.log(`[teams] User ${userId} joined team ${teamName} (${teamId})`);
    return { teamId, teamName };
  }

  leaveTeam(teamId: string, userId: string): void {
    // Check if user is last admin
    const adminRows = this.db.exec(
      'SELECT COUNT(*) FROM team_members WHERE team_id = ? AND role = ?',
      [teamId, 'admin']
    );
    const adminCount = adminRows[0]?.values[0]?.[0] as number ?? 0;

    const userRoleRows = this.db.exec(
      'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );
    const userRole = userRoleRows[0]?.values[0]?.[0] as string;

    if (adminCount === 1 && userRole === 'admin') {
      throw new Error('Cannot leave: you are the last admin. Transfer ownership or delete the team.');
    }

    this.db.run('DELETE FROM team_members WHERE team_id = ? AND user_id = ?', [teamId, userId]);
    console.log(`[teams] User ${userId} left team ${teamId}`);
  }

  getTeams(userId: string): Array<{ id: string; name: string; role: string; memberCount: number; joinCode?: string }> {
    const rows = this.db.exec(`
      SELECT
        t.id,
        t.name,
        t.join_code,
        tm.role,
        (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count
      FROM teams t
      INNER JOIN team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = ?
      ORDER BY tm.joined_at DESC
    `, [userId]);

    if (!rows.length || !rows[0].values.length) return [];

    return rows[0].values.map((row: any[]) => ({
      id: row[0] as string,
      name: row[1] as string,
      joinCode: row[2] as string,
      role: row[3] as string,
      memberCount: row[4] as number,
    }));
  }

  getTeamMembers(teamId: string): Array<{ userId: string; userName: string; role: string; joinedAt: string }> {
    const rows = this.db.exec(`
      SELECT user_id, user_name, role, joined_at
      FROM team_members
      WHERE team_id = ?
      ORDER BY joined_at ASC
    `, [teamId]);

    if (!rows.length || !rows[0].values.length) return [];

    return rows[0].values.map((row: any[]) => ({
      userId: row[0] as string,
      userName: row[1] as string,
      role: row[2] as string,
      joinedAt: row[3] as string,
    }));
  }

  generateJoinCode(teamId: string): string {
    // Generate readable 8-character code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude ambiguous chars
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}

export function registerTeamRoutes(app: Application, teamManager: TeamManager): void {
  // Create team
  app.post('/api/teams', (req: Request, res: Response) => {
    try {
      const userId = req.headers['x-user-id'] as string ?? 'anonymous';
      const { name } = req.body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Team name is required' });
        return;
      }

      const team = teamManager.createTeam(name.trim(), userId);
      res.json(team);
    } catch (err: any) {
      console.error('[teams] Error creating team:', err);
      res.status(500).json({ error: err.message ?? 'Failed to create team' });
    }
  });

  // Join team
  app.post('/api/teams/join', (req: Request, res: Response) => {
    try {
      const userId = req.headers['x-user-id'] as string ?? 'anonymous';
      const userName = req.headers['x-user-name'] as string ?? userId;
      const { joinCode } = req.body;

      if (!joinCode || typeof joinCode !== 'string') {
        res.status(400).json({ error: 'Join code is required' });
        return;
      }

      const result = teamManager.joinTeam(joinCode.trim().toUpperCase(), userId, userName);
      res.json(result);
    } catch (err: any) {
      console.error('[teams] Error joining team:', err);
      res.status(400).json({ error: err.message ?? 'Failed to join team' });
    }
  });

  // List user's teams
  app.get('/api/teams', (req: Request, res: Response) => {
    try {
      const userId = req.headers['x-user-id'] as string ?? 'anonymous';
      const teams = teamManager.getTeams(userId);
      res.json({ teams });
    } catch (err: any) {
      console.error('[teams] Error listing teams:', err);
      res.status(500).json({ error: err.message ?? 'Failed to list teams' });
    }
  });

  // Get team members
  app.get('/api/teams/:id/members', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const members = teamManager.getTeamMembers(id);
      res.json({ members });
    } catch (err: any) {
      console.error('[teams] Error getting team members:', err);
      res.status(500).json({ error: err.message ?? 'Failed to get team members' });
    }
  });

  // Leave team
  app.delete('/api/teams/:id/leave', (req: Request, res: Response) => {
    try {
      const userId = req.headers['x-user-id'] as string ?? 'anonymous';
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

      teamManager.leaveTeam(id, userId);
      res.json({ success: true });
    } catch (err: any) {
      console.error('[teams] Error leaving team:', err);
      res.status(400).json({ error: err.message ?? 'Failed to leave team' });
    }
  });

  console.log('[teams] Team routes registered → POST /api/teams, POST /api/teams/join, GET /api/teams, GET /api/teams/:id/members, DELETE /api/teams/:id/leave');
}
