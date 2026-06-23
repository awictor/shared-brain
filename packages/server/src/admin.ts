import type { Application, Request, Response, NextFunction } from 'express';

/**
 * Admin Panel — localhost-only management interface
 *
 * Features:
 * - Users tab: all users, memory counts, revoke access
 * - Teams tab: manage teams, regenerate join codes, delete teams
 * - System tab: env vars, DB size, metrics, backups
 * - Security tab: audit logs, rate limits, blocked requests
 */

// ─── Localhost-only middleware ──────────────────────────────────────────────

const localhostOnly = (req: Request, res: Response, next: NextFunction): void => {
  const clientIp = req.ip || req.socket.remoteAddress || '';
  const isLocalhost =
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1' ||
    clientIp.startsWith('127.') ||
    clientIp === 'localhost';

  if (!isLocalhost) {
    res.status(403).json({ error: 'Admin panel is only accessible from localhost' });
    return;
  }

  next();
};

// ─── HTML Template ──────────────────────────────────────────────────────────

const renderAdminPanel = (): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SharedBrain Admin Panel</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #1a2332;
      color: #e0e0e0;
      padding: 0;
      margin: 0;
    }
    .header {
      background: linear-gradient(135deg, #232f3e 0%, #1a2332 100%);
      padding: 1.5rem 2rem;
      border-bottom: 2px solid #FF6100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .header h1 {
      font-size: 1.8rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 0.25rem;
    }
    .header .subtitle {
      font-size: 0.9rem;
      color: #9ca3af;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 2rem;
      border-bottom: 2px solid #2d3748;
      padding-bottom: 0;
    }
    .tab {
      padding: 0.75rem 1.5rem;
      background: transparent;
      border: none;
      color: #9ca3af;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 500;
      border-bottom: 3px solid transparent;
      transition: all 0.2s;
    }
    .tab:hover { color: #FF6100; }
    .tab.active {
      color: #FF6100;
      border-bottom-color: #FF6100;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .card {
      background: #232f3e;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      border: 1px solid #2d3748;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .card h2 {
      font-size: 1.3rem;
      margin-bottom: 1rem;
      color: #fff;
      border-bottom: 1px solid #2d3748;
      padding-bottom: 0.5rem;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .stat-card {
      background: #1a2332;
      padding: 1.25rem;
      border-radius: 6px;
      border: 1px solid #2d3748;
    }
    .stat-label {
      font-size: 0.85rem;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
    }
    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: #FF6100;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    th, td {
      text-align: left;
      padding: 0.875rem;
      border-bottom: 1px solid #2d3748;
    }
    th {
      background: #1a2332;
      font-weight: 600;
      color: #FF6100;
      text-transform: uppercase;
      font-size: 0.85rem;
      letter-spacing: 0.5px;
    }
    td { color: #e0e0e0; }
    tr:hover td { background: #1a2332; }

    button {
      background: #FF6100;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
      font-weight: 500;
      transition: all 0.2s;
    }
    button:hover {
      background: #e55500;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(255, 97, 0, 0.3);
    }
    button.secondary {
      background: #2d3748;
      color: #e0e0e0;
    }
    button.secondary:hover {
      background: #3d4758;
      transform: translateY(-1px);
    }
    button.danger {
      background: #dc2626;
    }
    button.danger:hover { background: #b91c1c; }

    .config-grid {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 0.75rem;
      align-items: center;
    }
    .config-label {
      font-weight: 600;
      color: #9ca3af;
    }
    .config-value {
      padding: 0.5rem;
      background: #1a2332;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
      color: #10b981;
    }

    .alert {
      padding: 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      border-left: 4px solid;
    }
    .alert.info {
      background: rgba(59, 130, 246, 0.1);
      border-color: #3b82f6;
      color: #93c5fd;
    }
    .alert.warning {
      background: rgba(245, 158, 11, 0.1);
      border-color: #f59e0b;
      color: #fbbf24;
    }
    .alert.danger {
      background: rgba(220, 38, 38, 0.1);
      border-color: #dc2626;
      color: #fca5a5;
    }

    .loading {
      text-align: center;
      padding: 2rem;
      color: #9ca3af;
    }
    .spinner {
      border: 3px solid #2d3748;
      border-top: 3px solid #FF6100;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 1rem auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      background: #2d3748;
      color: #9ca3af;
    }
    .badge.active { background: #10b981; color: white; }
    .badge.warning { background: #f59e0b; color: white; }
  </style>
</head>
<body>
  <div class="header">
    <h1>🧠 SharedBrain Admin Panel</h1>
    <div class="subtitle">System Management & Configuration</div>
  </div>

  <div class="container">
    <div class="tabs">
      <button class="tab active" data-tab="users">Users</button>
      <button class="tab" data-tab="teams">Teams</button>
      <button class="tab" data-tab="system">System</button>
      <button class="tab" data-tab="security">Security</button>
    </div>

    <!-- Users Tab -->
    <div class="tab-content active" id="users-tab">
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">Total Users</div>
          <div class="stat-value" id="total-users">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Users</div>
          <div class="stat-value" id="active-users">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Memories</div>
          <div class="stat-value" id="total-memories">—</div>
        </div>
      </div>

      <div class="card">
        <h2>All Users</h2>
        <div id="users-table" class="loading">
          <div class="spinner"></div>
          Loading users...
        </div>
      </div>
    </div>

    <!-- Teams Tab -->
    <div class="tab-content" id="teams-tab">
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">Total Teams</div>
          <div class="stat-value" id="total-teams">—</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Members</div>
          <div class="stat-value" id="total-team-members">—</div>
        </div>
      </div>

      <div class="card">
        <h2>All Teams</h2>
        <div id="teams-table" class="loading">
          <div class="spinner"></div>
          Loading teams...
        </div>
      </div>
    </div>

    <!-- System Tab -->
    <div class="tab-content" id="system-tab">
      <div class="card">
        <h2>System Metrics</h2>
        <div class="stats">
          <div class="stat-card">
            <div class="stat-label">Memory Count</div>
            <div class="stat-value" id="sys-memory-count">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Vector Index Size</div>
            <div class="stat-value" id="sys-vector-count">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Uptime</div>
            <div class="stat-value" id="sys-uptime">—</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Heap Used</div>
            <div class="stat-value" id="sys-heap">—</div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Environment Configuration</h2>
        <div class="config-grid" id="env-config">
          <div class="loading">
            <div class="spinner"></div>
            Loading...
          </div>
        </div>
      </div>

      <div class="card">
        <h2>Backup Status</h2>
        <div id="backup-status" class="loading">
          <div class="spinner"></div>
          Loading...
        </div>
      </div>
    </div>

    <!-- Security Tab -->
    <div class="tab-content" id="security-tab">
      <div class="card">
        <h2>Security Status</h2>
        <div id="security-status" class="loading">
          <div class="spinner"></div>
          Loading...
        </div>
      </div>

      <div class="card">
        <h2>Rate Limiting</h2>
        <div id="rate-limits" class="loading">
          <div class="spinner"></div>
          Loading...
        </div>
      </div>

      <div class="card">
        <h2>Recent Audit Log</h2>
        <div id="audit-log" class="loading">
          <div class="spinner"></div>
          Loading...
        </div>
      </div>
    </div>
  </div>

  <script>
    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab + '-tab').classList.add('active');

        // Load data for the tab
        const tabName = tab.dataset.tab;
        if (tabName === 'users') loadUsers();
        if (tabName === 'teams') loadTeams();
        if (tabName === 'system') loadSystem();
        if (tabName === 'security') loadSecurity();
      });
    });

    // Format helpers
    const formatDate = (iso) => {
      const d = new Date(iso);
      return d.toLocaleString();
    };

    const formatUptime = (seconds) => {
      const d = Math.floor(seconds / 86400);
      const h = Math.floor((seconds % 86400) / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      return \`\${d}d \${h}h \${m}m\`;
    };

    const formatSize = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    };

    // Load Users
    async function loadUsers() {
      try {
        const [usersResp, metricsResp] = await Promise.all([
          fetch('/api/users'),
          fetch('/api/metrics')
        ]);

        const usersData = await usersResp.json();
        const metricsData = await metricsResp.json();

        const users = usersData.users || [];

        document.getElementById('total-users').textContent = users.length;
        document.getElementById('active-users').textContent = metricsData.active_users || 0;
        document.getElementById('total-memories').textContent = metricsData.memory_count || 0;

        if (users.length === 0) {
          document.getElementById('users-table').innerHTML = '<div class="alert info">No users found.</div>';
          return;
        }

        let html = '<table><thead><tr><th>User ID</th><th>Display Name</th><th>Memories</th><th>Last Active</th><th>Actions</th></tr></thead><tbody>';

        for (const user of users) {
          html += \`<tr>
            <td>\${user.userId}</td>
            <td>\${user.displayName || '—'}</td>
            <td>\${user.memoryCount || 0}</td>
            <td>\${formatDate(user.lastActive)}</td>
            <td><button class="danger" onclick="revokeAccess('\${user.userId}')">Revoke Access</button></td>
          </tr>\`;
        }

        html += '</tbody></table>';
        document.getElementById('users-table').innerHTML = html;
      } catch (err) {
        document.getElementById('users-table').innerHTML = \`<div class="alert danger">Error loading users: \${err.message}</div>\`;
      }
    }

    // Load Teams
    async function loadTeams() {
      try {
        const resp = await fetch('/api/admin/teams');
        const data = await resp.json();
        const teams = data.teams || [];

        document.getElementById('total-teams').textContent = teams.length;
        document.getElementById('total-team-members').textContent = teams.reduce((sum, t) => sum + t.memberCount, 0);

        if (teams.length === 0) {
          document.getElementById('teams-table').innerHTML = '<div class="alert info">No teams found.</div>';
          return;
        }

        let html = '<table><thead><tr><th>Team Name</th><th>Members</th><th>Join Code</th><th>Created By</th><th>Created At</th><th>Actions</th></tr></thead><tbody>';

        for (const team of teams) {
          html += \`<tr>
            <td><strong>\${team.name}</strong></td>
            <td>\${team.memberCount}</td>
            <td><code style="background:#1a2332;padding:0.25rem 0.5rem;border-radius:4px;">\${team.joinCode}</code></td>
            <td>\${team.createdBy}</td>
            <td>\${formatDate(team.createdAt)}</td>
            <td>
              <button class="secondary" onclick="regenerateCode('\${team.id}')">Regenerate Code</button>
              <button class="danger" onclick="deleteTeam('\${team.id}', '\${team.name}')">Delete</button>
            </td>
          </tr>\`;
        }

        html += '</tbody></table>';
        document.getElementById('teams-table').innerHTML = html;
      } catch (err) {
        document.getElementById('teams-table').innerHTML = \`<div class="alert danger">Error loading teams: \${err.message}</div>\`;
      }
    }

    // Load System
    async function loadSystem() {
      try {
        const [metricsResp, backupResp] = await Promise.all([
          fetch('/api/metrics'),
          fetch('/api/backup/status')
        ]);

        const metrics = await metricsResp.json();
        const backup = await backupResp.json();

        // System metrics
        document.getElementById('sys-memory-count').textContent = metrics.memory_count || 0;
        document.getElementById('sys-vector-count').textContent = metrics.vector_index_size || 0;
        document.getElementById('sys-uptime').textContent = formatUptime(metrics.uptime_seconds || 0);
        document.getElementById('sys-heap').textContent = (metrics.heap_used_mb || 0) + ' MB';

        // Environment config
        const env = {
          'PORT': window.location.port || '3100',
          'HOST': window.location.hostname,
          'NODE_ENV': 'production',
          'DB_PATH': backup.dbPath || '—',
          'AUTH_TOKEN': '••••••••' // masked
        };

        let envHtml = '';
        for (const [key, val] of Object.entries(env)) {
          envHtml += \`<div class="config-label">\${key}</div><div class="config-value">\${val}</div>\`;
        }
        document.getElementById('env-config').innerHTML = envHtml;

        // Backup status
        let backupHtml = \`
          <div class="config-grid">
            <div class="config-label">Last Backup</div>
            <div class="config-value">\${backup.lastBackup ? formatDate(backup.lastBackup) : 'Never'}</div>
            <div class="config-label">Backup Count</div>
            <div class="config-value">\${backup.backupCount || 0}</div>
            <div class="config-label">Total Size</div>
            <div class="config-value">\${formatSize(backup.totalSize || 0)}</div>
            <div class="config-label">DB File Size</div>
            <div class="config-value">\${formatSize(backup.dbSize || 0)}</div>
          </div>
          <div style="margin-top:1rem;">
            <button onclick="backupNow()">Backup Now</button>
            <button class="danger" onclick="clearAuditLog()">Clear Audit Log</button>
          </div>
        \`;
        document.getElementById('backup-status').innerHTML = backupHtml;
      } catch (err) {
        document.getElementById('backup-status').innerHTML = \`<div class="alert danger">Error: \${err.message}</div>\`;
      }
    }

    // Load Security
    async function loadSecurity() {
      try {
        const [auditDataResp, auditLogResp, rateLimitResp, statusResp] = await Promise.all([
          fetch('/api/security/audit'),
          fetch('/api/audit'),
          fetch('/api/security/ratelimits'),
          fetch('/api/security/status')
        ]);

        const auditData = await auditDataResp.json();
        const auditLog = await auditLogResp.json();
        const rateLimits = await rateLimitResp.json();
        const status = await statusResp.json();

        // Security status
        let statusHtml = \`
          <div class="config-grid">
            <div class="config-label">Auth Token</div>
            <div class="config-value"><span class="badge active">Active</span></div>
            <div class="config-label">Rate Limiting</div>
            <div class="config-value"><span class="badge active">Enabled</span></div>
            <div class="config-label">Audit Logging</div>
            <div class="config-value"><span class="badge active">Enabled</span></div>
            <div class="config-label">Requests Blocked</div>
            <div class="config-value">\${status.requestsBlocked || 0}</div>
          </div>
        \`;
        document.getElementById('security-status').innerHTML = statusHtml;

        // Rate limits (rateLimits is an array directly, not wrapped)
        const limits = Array.isArray(rateLimits) ? rateLimits : [];
        if (limits.length === 0) {
          document.getElementById('rate-limits').innerHTML = '<div class="alert info">No active rate limits.</div>';
        } else {
          let limitsHtml = '<table><thead><tr><th>IP</th><th>Endpoint</th><th>Count</th><th>Limit</th><th>Remaining</th></tr></thead><tbody>';
          for (const limit of limits.slice(0, 20)) {
            limitsHtml += \`<tr>
              <td>\${limit.ip}</td>
              <td><code>\${limit.endpoint}</code></td>
              <td>\${limit.count}</td>
              <td>\${limit.limit}</td>
              <td>\${limit.remaining}</td>
            </tr>\`;
          }
          limitsHtml += '</tbody></table>';
          document.getElementById('rate-limits').innerHTML = limitsHtml;
        }

        // Audit log
        const entries = Array.isArray(auditLog) ? auditLog : [];
        if (entries.length === 0) {
          document.getElementById('audit-log').innerHTML = '<div class="alert info">No audit entries.</div>';
        } else {
          let auditHtml = '<table><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>IP</th><th>Status</th><th>Duration</th></tr></thead><tbody>';
          for (const entry of entries.slice(0, 50)) {
            const statusClass = entry.statusCode >= 400 ? 'danger' : '';
            auditHtml += \`<tr>
              <td>\${formatDate(entry.timestamp)}</td>
              <td><strong>\${entry.method}</strong></td>
              <td><code>\${entry.path}</code></td>
              <td>\${entry.ip}</td>
              <td><span class="badge \${statusClass}">\${entry.statusCode}</span></td>
              <td>\${entry.durationMs.toFixed(1)}ms</td>
            </tr>\`;
          }
          auditHtml += '</tbody></table>';
          document.getElementById('audit-log').innerHTML = auditHtml;
        }
      } catch (err) {
        document.getElementById('audit-log').innerHTML = \`<div class="alert danger">Error: \${err.message}</div>\`;
      }
    }

    // Actions
    async function revokeAccess(userId) {
      if (!confirm(\`Revoke access for user \${userId}? This will invalidate their JWT token.\`)) return;
      try {
        const resp = await fetch('/api/admin/users/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId })
        });
        if (!resp.ok) throw new Error(await resp.text());
        alert('Access revoked successfully.');
        loadUsers();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function regenerateCode(teamId) {
      if (!confirm('Regenerate join code? Old code will be invalidated.')) return;
      try {
        const resp = await fetch('/api/admin/teams/regenerate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId })
        });
        if (!resp.ok) throw new Error(await resp.text());
        alert('Join code regenerated successfully.');
        loadTeams();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function deleteTeam(teamId, teamName) {
      if (!confirm(\`Delete team "\${teamName}"? This will remove all members and cannot be undone.\`)) return;
      try {
        const resp = await fetch('/api/admin/teams/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamId })
        });
        if (!resp.ok) throw new Error(await resp.text());
        alert('Team deleted successfully.');
        loadTeams();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function backupNow() {
      if (!confirm('Create a backup now?')) return;
      try {
        const resp = await fetch('/api/backup/now', { method: 'POST' });
        if (!resp.ok) throw new Error(await resp.text());
        const result = await resp.json();
        alert(\`Backup created: \${formatSize(result.size)}\`);
        loadSystem();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    async function clearAuditLog() {
      if (!confirm('Clear all audit log entries? This cannot be undone.')) return;
      try {
        const resp = await fetch('/api/admin/audit/clear', { method: 'POST' });
        if (!resp.ok) throw new Error(await resp.text());
        alert('Audit log cleared.');
        loadSecurity();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    // Load initial tab
    loadUsers();
  </script>
</body>
</html>`;

// ─── Admin API Routes ───────────────────────────────────────────────────────

export function registerAdmin(app: Application): void {
  // Main admin panel (localhost-only)
  app.get('/admin', localhostOnly, (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(renderAdminPanel());
  });

  // API: Get all teams with member counts
  app.get('/api/admin/teams', localhostOnly, (req: Request, res: Response) => {
    try {
      const store = (app as any).locals?.store;
      if (!store?.db) {
        res.status(500).json({ error: 'Store not initialized' });
        return;
      }

      const teamsRows = store.db.exec(`
        SELECT
          t.id,
          t.name,
          t.join_code,
          t.created_by,
          t.created_at,
          COUNT(tm.user_id) as member_count
        FROM teams t
        LEFT JOIN team_members tm ON t.id = tm.team_id
        GROUP BY t.id
        ORDER BY t.created_at DESC
      `);

      if (!teamsRows.length || !teamsRows[0].values.length) {
        res.json({ teams: [] });
        return;
      }

      const teams = teamsRows[0].values.map((row: any) => {
        const cols = teamsRows[0].columns;
        const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
        return {
          id: r.id,
          name: r.name,
          joinCode: r.join_code,
          createdBy: r.created_by,
          createdAt: r.created_at,
          memberCount: r.member_count || 0,
        };
      });

      res.json({ teams });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to load teams' });
    }
  });

  // API: Revoke user access (invalidate JWT token)
  app.post('/api/admin/users/revoke', localhostOnly, (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        res.status(400).json({ error: 'userId required' });
        return;
      }

      const store = (app as any).locals?.store;
      if (!store?.db) {
        res.status(500).json({ error: 'Store not initialized' });
        return;
      }

      // Delete all JWT tokens for this user
      store.db.run('DELETE FROM jwt_tokens WHERE user_id = ?', [userId]);

      res.json({ success: true, message: `Access revoked for user ${userId}` });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to revoke access' });
    }
  });

  // API: Regenerate team join code
  app.post('/api/admin/teams/regenerate', localhostOnly, (req: Request, res: Response) => {
    try {
      const { teamId } = req.body;
      if (!teamId) {
        res.status(400).json({ error: 'teamId required' });
        return;
      }

      const store = (app as any).locals?.store;
      if (!store?.db) {
        res.status(500).json({ error: 'Store not initialized' });
        return;
      }

      // Generate new join code
      const { randomBytes } = require('crypto');
      const newCode = randomBytes(4).toString('hex').toUpperCase();

      store.db.run('UPDATE teams SET join_code = ? WHERE id = ?', [newCode, teamId]);

      res.json({ success: true, newCode });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to regenerate code' });
    }
  });

  // API: Delete team
  app.post('/api/admin/teams/delete', localhostOnly, (req: Request, res: Response) => {
    try {
      const { teamId } = req.body;
      if (!teamId) {
        res.status(400).json({ error: 'teamId required' });
        return;
      }

      const store = (app as any).locals?.store;
      if (!store?.db) {
        res.status(500).json({ error: 'Store not initialized' });
        return;
      }

      // Delete team members first (foreign key constraint)
      store.db.run('DELETE FROM team_members WHERE team_id = ?', [teamId]);

      // Delete team
      store.db.run('DELETE FROM teams WHERE id = ?', [teamId]);

      res.json({ success: true, message: `Team ${teamId} deleted` });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to delete team' });
    }
  });

  // API: Clear audit log
  app.post('/api/admin/audit/clear', localhostOnly, (req: Request, res: Response) => {
    try {
      const store = (app as any).locals?.store;
      if (!store?.db) {
        res.status(500).json({ error: 'Store not initialized' });
        return;
      }

      store.db.run('DELETE FROM audit_log');

      res.json({ success: true, message: 'Audit log cleared' });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to clear audit log' });
    }
  });

  console.log('[admin] Admin panel registered → /admin (localhost only)');
}
