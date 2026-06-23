import type { Application, Request, Response } from 'express';
import type { TeamManager } from './teams.js';

export function registerTeamsDemo(app: Application, teamManager: TeamManager): void {
  app.get('/demo/teams', (_req: Request, res: Response) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Management | SharedBrain</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a2332;
      color: #F5F3EF;
      line-height: 1.6;
      padding: 2rem;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #FF6100;
      margin-bottom: 2rem;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #FF6100;
      margin: 2rem 0 1rem;
    }
    .section {
      background: #243447;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    label {
      display: block;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #FF6100;
    }
    input[type="text"] {
      width: 100%;
      padding: 0.75rem;
      background: #1a2332;
      border: 1px solid #3a4a5f;
      border-radius: 4px;
      color: #F5F3EF;
      font-size: 1rem;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: #FF6100;
    }
    button {
      background: #FF6100;
      color: #F5F3EF;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #e55600;
    }
    button:disabled {
      background: #666;
      cursor: not-allowed;
    }
    .team-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .team-card {
      background: #1a2332;
      border: 1px solid #3a4a5f;
      border-radius: 6px;
      padding: 1rem;
      cursor: pointer;
      transition: border-color 0.2s;
    }
    .team-card:hover {
      border-color: #FF6100;
    }
    .team-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .team-name {
      font-size: 1.25rem;
      font-weight: 600;
      color: #F5F3EF;
    }
    .team-meta {
      display: flex;
      gap: 1rem;
      font-size: 0.875rem;
      color: #8a9fb0;
      margin-top: 0.5rem;
    }
    .team-badge {
      background: #FF6100;
      color: #F5F3EF;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .team-members {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid #3a4a5f;
      display: none;
    }
    .team-card.expanded .team-members {
      display: block;
    }
    .member-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem;
      background: #243447;
      border-radius: 4px;
      margin-bottom: 0.5rem;
    }
    .member-name {
      font-weight: 600;
    }
    .member-role {
      font-size: 0.875rem;
      color: #8a9fb0;
    }
    .join-code {
      background: #1a2332;
      border: 1px solid #FF6100;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 1.25rem;
      color: #FF6100;
      text-align: center;
      margin-top: 0.5rem;
      user-select: all;
    }
    .empty-state {
      text-align: center;
      color: #8a9fb0;
      padding: 2rem;
      font-style: italic;
    }
    .error {
      background: #d32f2f;
      color: white;
      padding: 1rem;
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    .success {
      background: #388e3c;
      color: white;
      padding: 1rem;
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    .action-btn {
      background: transparent;
      border: 1px solid #FF6100;
      color: #FF6100;
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
    }
    .action-btn:hover {
      background: #FF6100;
      color: #F5F3EF;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Team Management</h1>

    <div id="message-area"></div>

    <div class="section">
      <h2>Create Team</h2>
      <div class="form-group">
        <label for="team-name">Team Name</label>
        <input type="text" id="team-name" placeholder="Enter team name">
      </div>
      <button id="create-team-btn">Create Team</button>
    </div>

    <div class="section">
      <h2>Join Team</h2>
      <div class="form-group">
        <label for="join-code">Join Code</label>
        <input type="text" id="join-code" placeholder="Enter 8-character code" maxlength="8" style="text-transform: uppercase;">
      </div>
      <button id="join-team-btn">Join Team</button>
    </div>

    <div class="section">
      <h2>My Teams</h2>
      <div id="teams-list" class="team-list">
        <div class="empty-state">Loading teams...</div>
      </div>
    </div>
  </div>

  <script>
    const userId = 'demo-user-' + Math.random().toString(36).substr(2, 9);
    const userName = 'Demo User';

    function showMessage(text, type = 'success') {
      const area = document.getElementById('message-area');
      const div = document.createElement('div');
      div.className = type;
      div.textContent = text;
      area.appendChild(div);
      setTimeout(() => div.remove(), 5000);
    }

    async function createTeam() {
      const name = document.getElementById('team-name').value.trim();
      if (!name) {
        showMessage('Team name is required', 'error');
        return;
      }

      try {
        const resp = await fetch('/api/teams', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
            'X-User-Name': userName,
          },
          body: JSON.stringify({ name }),
        });

        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Failed to create team');
        }

        const team = await resp.json();
        showMessage(\`Team "\${team.name}" created! Join code: \${team.joinCode}\`);
        document.getElementById('team-name').value = '';
        loadTeams();
      } catch (err) {
        showMessage(err.message, 'error');
      }
    }

    async function joinTeam() {
      const joinCode = document.getElementById('join-code').value.trim().toUpperCase();
      if (!joinCode || joinCode.length !== 8) {
        showMessage('Enter a valid 8-character join code', 'error');
        return;
      }

      try {
        const resp = await fetch('/api/teams/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
            'X-User-Name': userName,
          },
          body: JSON.stringify({ joinCode }),
        });

        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Failed to join team');
        }

        const result = await resp.json();
        showMessage(\`Joined team "\${result.teamName}"!\`);
        document.getElementById('join-code').value = '';
        loadTeams();
      } catch (err) {
        showMessage(err.message, 'error');
      }
    }

    async function loadTeams() {
      const container = document.getElementById('teams-list');

      try {
        const resp = await fetch('/api/teams', {
          headers: {
            'X-User-Id': userId,
            'X-User-Name': userName,
          },
        });

        if (!resp.ok) throw new Error('Failed to load teams');

        const { teams } = await resp.json();

        if (teams.length === 0) {
          container.innerHTML = '<div class="empty-state">No teams yet. Create or join a team to get started.</div>';
          return;
        }

        container.innerHTML = teams.map(team => \`
          <div class="team-card" data-team-id="\${team.id}">
            <div class="team-header">
              <div>
                <div class="team-name">\${team.name}</div>
                <div class="team-meta">
                  <span>\${team.memberCount} member\${team.memberCount !== 1 ? 's' : ''}</span>
                  <span class="team-badge">\${team.role}</span>
                </div>
              </div>
              <button class="action-btn" onclick="leaveTeam('\${team.id}', event)">Leave</button>
            </div>
            \${team.role === 'admin' ? \`<div class="join-code">Join Code: \${team.joinCode}</div>\` : ''}
            <div class="team-members">
              <div id="members-\${team.id}">Loading members...</div>
            </div>
          </div>
        \`).join('');

        // Add click handlers for expansion
        document.querySelectorAll('.team-card').forEach(card => {
          card.addEventListener('click', (e) => {
            if (e.target.classList.contains('action-btn')) return;
            card.classList.toggle('expanded');
            if (card.classList.contains('expanded')) {
              loadMembers(card.dataset.teamId);
            }
          });
        });
      } catch (err) {
        container.innerHTML = \`<div class="empty-state">Error loading teams: \${err.message}</div>\`;
      }
    }

    async function loadMembers(teamId) {
      const container = document.getElementById(\`members-\${teamId}\`);

      try {
        const resp = await fetch(\`/api/teams/\${teamId}/members\`, {
          headers: {
            'X-User-Id': userId,
            'X-User-Name': userName,
          },
        });

        if (!resp.ok) throw new Error('Failed to load members');

        const { members } = await resp.json();

        container.innerHTML = members.map(m => \`
          <div class="member-item">
            <div>
              <div class="member-name">\${m.userName}</div>
              <div class="member-role">\${m.role} · Joined \${new Date(m.joinedAt).toLocaleDateString()}</div>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        container.innerHTML = \`<div style="color: #d32f2f;">Error: \${err.message}</div>\`;
      }
    }

    async function leaveTeam(teamId, event) {
      event.stopPropagation();

      if (!confirm('Are you sure you want to leave this team?')) return;

      try {
        const resp = await fetch(\`/api/teams/\${teamId}/leave\`, {
          method: 'DELETE',
          headers: {
            'X-User-Id': userId,
            'X-User-Name': userName,
          },
        });

        if (!resp.ok) {
          const err = await resp.json();
          throw new Error(err.error || 'Failed to leave team');
        }

        showMessage('Left team successfully');
        loadTeams();
      } catch (err) {
        showMessage(err.message, 'error');
      }
    }

    document.getElementById('create-team-btn').addEventListener('click', createTeam);
    document.getElementById('join-team-btn').addEventListener('click', joinTeam);

    // Auto-uppercase join code as user types
    document.getElementById('join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase();
    });

    // Load teams on page load
    loadTeams();
  </script>
</body>
</html>`);
  });

  console.log('[teams-demo] Teams demo UI registered → GET /demo/teams');
}
