/**
 * Identity Demo Dashboard
 *
 * Registers GET /demo/identity — an inline HTML dashboard showing:
 * - Registered agents, last seen, memories created
 * - Active sessions
 * - Register New Agent form
 * - Recent cross-agent activity feed
 */

import type { Application } from 'express';
import type { IdentityManager } from './identity.js';

export function registerIdentityDemo(app: Application, identityManager: IdentityManager): void {
  // API endpoints for the dashboard
  app.get('/api/identity/agents', (_req, res) => {
    const agents = identityManager.getAllAgents();
    res.json(agents);
  });

  app.get('/api/identity/active', (_req, res) => {
    const active = identityManager.getActiveAgents();
    res.json(active);
  });

  app.get('/api/identity/activity/:agentId', (req, res) => {
    const activity = identityManager.getRecentCrossAgentActivity(req.params.agentId, 20);
    res.json(activity);
  });

  app.post('/api/identity/register', (req, res) => {
    const { name, userId, deviceId } = req.body;
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const agent = identityManager.registerAgent(name, userId, deviceId);
    res.json(agent);
  });

  app.get('/api/identity/user/:userId', (req, res) => {
    const profile = identityManager.getUserProfile(req.params.userId);
    if (!profile) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(profile);
  });

  // Dashboard HTML
  app.get('/demo/identity', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(DASHBOARD_HTML);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SharedBrain - Agent Identity Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #232F3E;
    color: #F5F3EF;
    min-height: 100vh;
    padding: 2rem;
  }
  h1 {
    font-size: 1.8rem;
    margin-bottom: 0.5rem;
    color: #FF6100;
  }
  h2 {
    font-size: 1.2rem;
    margin-bottom: 1rem;
    color: #FF6100;
    border-bottom: 1px solid #3a4a5e;
    padding-bottom: 0.5rem;
  }
  .subtitle {
    color: #8899aa;
    font-size: 0.9rem;
    margin-bottom: 2rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    margin-bottom: 1.5rem;
  }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .card {
    background: #1a2533;
    border: 1px solid #3a4a5e;
    border-radius: 8px;
    padding: 1.5rem;
  }
  .card.full { grid-column: 1 / -1; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  th {
    text-align: left;
    padding: 0.5rem 0.75rem;
    color: #8899aa;
    font-weight: 500;
    border-bottom: 1px solid #3a4a5e;
  }
  td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid #2a3a4e;
  }
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .badge-active { background: #0f5132; color: #75d6a3; }
  .badge-inactive { background: #3a2f1a; color: #c49a3c; }
  .badge-agent { background: #1a3a5e; color: #6cb4ee; }
  .form-group {
    margin-bottom: 1rem;
  }
  label {
    display: block;
    font-size: 0.8rem;
    color: #8899aa;
    margin-bottom: 0.3rem;
  }
  input[type="text"], input[type="email"] {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: #232F3E;
    border: 1px solid #3a4a5e;
    border-radius: 4px;
    color: #F5F3EF;
    font-size: 0.85rem;
  }
  input:focus {
    outline: none;
    border-color: #FF6100;
  }
  button {
    padding: 0.5rem 1.5rem;
    background: #FF6100;
    color: #fff;
    border: none;
    border-radius: 4px;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  button:hover { background: #e55800; }
  .activity-item {
    padding: 0.6rem 0;
    border-bottom: 1px solid #2a3a4e;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .activity-item:last-child { border-bottom: none; }
  .activity-icon {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #1a3a5e;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    flex-shrink: 0;
  }
  .activity-text {
    font-size: 0.83rem;
    flex: 1;
  }
  .activity-time {
    font-size: 0.72rem;
    color: #8899aa;
  }
  .stat-row {
    display: flex;
    gap: 2rem;
    margin-bottom: 1.5rem;
  }
  .stat {
    text-align: center;
  }
  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: #FF6100;
  }
  .stat-label {
    font-size: 0.75rem;
    color: #8899aa;
  }
  .empty {
    color: #5a6a7a;
    font-style: italic;
    padding: 1rem 0;
    text-align: center;
  }
  .toast {
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    background: #0f5132;
    color: #75d6a3;
    padding: 0.75rem 1.25rem;
    border-radius: 6px;
    font-size: 0.85rem;
    display: none;
    animation: fadeIn 0.3s;
  }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<h1>SharedBrain Agent Identity</h1>
<p class="subtitle">Cross-agent identity system — track which AI agents share this brain</p>

<div class="stat-row" id="stats">
  <div class="stat"><div class="stat-value" id="stat-agents">-</div><div class="stat-label">Registered Agents</div></div>
  <div class="stat"><div class="stat-value" id="stat-active">-</div><div class="stat-label">Active Now</div></div>
  <div class="stat"><div class="stat-value" id="stat-memories">-</div><div class="stat-label">Total Memories</div></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Registered Agents</h2>
    <div id="agents-table"><p class="empty">Loading...</p></div>
  </div>

  <div class="card">
    <h2>Register New Agent</h2>
    <form id="register-form">
      <div class="form-group">
        <label for="agent-name">Agent Name</label>
        <input type="text" id="agent-name" placeholder="e.g. claude-code, cursor, chatgpt" required>
      </div>
      <div class="form-group">
        <label for="user-id">User ID</label>
        <input type="text" id="user-id" placeholder="e.g. awictor" value="default">
      </div>
      <div class="form-group">
        <label for="device-id">Device ID (optional)</label>
        <input type="text" id="device-id" placeholder="auto-detected if empty">
      </div>
      <button type="submit">Register Agent</button>
    </form>
  </div>

  <div class="card">
    <h2>Active Sessions</h2>
    <div id="active-sessions"><p class="empty">Loading...</p></div>
  </div>

  <div class="card">
    <h2>Recent Cross-Agent Activity</h2>
    <div id="activity-feed"><p class="empty">Loading...</p></div>
  </div>
</div>

<div id="toast" class="toast"></div>

<script>
const BASE = window.location.origin;

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function agentIcon(name) {
  const map = { 'claude-code': 'CC', 'cursor': 'Cu', 'chatgpt': 'GP', 'copilot': 'Co' };
  return map[name] || name.substring(0, 2).toUpperCase();
}

async function loadAgents() {
  const res = await fetch(BASE + '/api/identity/agents');
  const agents = await res.json();

  document.getElementById('stat-agents').textContent = agents.length;
  const totalMemories = agents.reduce((sum, a) => sum + a.memoriesCreated, 0);
  document.getElementById('stat-memories').textContent = totalMemories;

  if (!agents.length) {
    document.getElementById('agents-table').innerHTML = '<p class="empty">No agents registered yet</p>';
    return;
  }

  let html = '<table><thead><tr><th>Agent</th><th>User</th><th>Last Seen</th><th>Memories</th><th>Status</th></tr></thead><tbody>';
  for (const a of agents) {
    const isActive = (Date.now() - new Date(a.lastSeen).getTime()) < 300000;
    const badge = isActive
      ? '<span class="badge badge-active">active</span>'
      : '<span class="badge badge-inactive">idle</span>';
    html += '<tr>';
    html += '<td><span class="badge badge-agent">' + agentIcon(a.name) + '</span> ' + a.name + '</td>';
    html += '<td>' + a.userId + '</td>';
    html += '<td>' + timeAgo(a.lastSeen) + '</td>';
    html += '<td>' + a.memoriesCreated + '</td>';
    html += '<td>' + badge + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  document.getElementById('agents-table').innerHTML = html;
}

async function loadActive() {
  const res = await fetch(BASE + '/api/identity/active');
  const active = await res.json();

  document.getElementById('stat-active').textContent = active.length;

  if (!active.length) {
    document.getElementById('active-sessions').innerHTML = '<p class="empty">No agents active in last 5 minutes</p>';
    return;
  }

  let html = '<table><thead><tr><th>Agent</th><th>Device</th><th>Since</th></tr></thead><tbody>';
  for (const a of active) {
    html += '<tr>';
    html += '<td><span class="badge badge-agent">' + agentIcon(a.name) + '</span> ' + a.name + '</td>';
    html += '<td style="font-size:0.75rem;color:#8899aa">' + a.deviceId + '</td>';
    html += '<td>' + timeAgo(a.lastSeen) + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table>';
  document.getElementById('active-sessions').innerHTML = html;
}

async function loadActivity() {
  // Use a placeholder agent ID to get all activity
  const res = await fetch(BASE + '/api/identity/activity/___none___');
  const activity = await res.json();

  if (!activity.length) {
    document.getElementById('activity-feed').innerHTML = '<p class="empty">No activity recorded yet</p>';
    return;
  }

  let html = '';
  for (const a of activity) {
    const actionText = a.action === 'memory_created'
      ? 'created memory' + (a.memoryTitle ? ': <em>' + a.memoryTitle + '</em>' : '')
      : a.action === 'registered' ? 'registered' : a.action;
    html += '<div class="activity-item">';
    html += '<div class="activity-icon">' + agentIcon(a.agentName) + '</div>';
    html += '<div class="activity-text"><strong>' + a.agentName + '</strong> ' + actionText + '</div>';
    html += '<div class="activity-time">' + timeAgo(a.timestamp) + '</div>';
    html += '</div>';
  }
  document.getElementById('activity-feed').innerHTML = html;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 3000);
}

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('agent-name').value.trim();
  const userId = document.getElementById('user-id').value.trim() || 'default';
  const deviceId = document.getElementById('device-id').value.trim() || undefined;

  const res = await fetch(BASE + '/api/identity/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, userId, deviceId }),
  });

  if (res.ok) {
    const agent = await res.json();
    showToast('Registered: ' + agent.name + ' (' + agent.id.substring(0, 8) + '...)');
    document.getElementById('agent-name').value = '';
    refresh();
  }
});

function refresh() {
  loadAgents();
  loadActive();
  loadActivity();
}

refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
