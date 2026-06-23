/**
 * Checkin Demo — GET /demo/checkin
 *
 * Shows what the memory_checkin tool returns, formatted as a morning briefing page.
 * Dark theme (#232F3E bg, #FF6100 accents, #F5F3EF text), auto-refreshes every 30s.
 */

import type { Application } from 'express';
import type { MemoryHandler, Store } from './mcp/handler.js';

export function registerCheckinDemo(app: Application, handler: MemoryHandler, store: Store): void {
  app.get('/demo/checkin', async (_req, res) => {
    try {
      // Gather data for the briefing
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      // Last 5 memories
      const recentResult = await handler.handleList({
        sort: 'newest',
        limit: 5,
        offset: 0,
      });

      // Today's memories
      const todayResult = await handler.handleList({
        sort: 'newest',
        limit: 50,
        offset: 0,
        filters: { since: todayStart },
      });

      // Active projects (tags with > 3 memories)
      const allTags = await store.getAllTags();
      const activeProjects = allTags.filter((t) => t.count > 3);

      // Pending action items (type=procedure or tag containing "action")
      const procedureResult = await handler.handleList({
        sort: 'newest',
        limit: 20,
        offset: 0,
        filters: { types: ['procedure'] },
      });

      const actionTagResult = await handler.handleList({
        sort: 'newest',
        limit: 20,
        offset: 0,
        filters: { tags: ['action', 'action-item', 'todo', 'task'] },
      });

      // Deduplicate action items
      const actionIds = new Set<string>();
      const pendingActions = [...procedureResult.memories, ...actionTagResult.memories].filter((m) => {
        if (actionIds.has(m.id)) return false;
        actionIds.add(m.id);
        return true;
      });

      // Cross-agent activity — memories with different source agents
      const allRecent = await handler.handleList({
        sort: 'newest',
        limit: 20,
        offset: 0,
      });
      const crossAgent = allRecent.memories.filter(
        (m) => m.source?.agent && m.source.agent !== 'local',
      );

      // Total count + last sync
      const syncStatus = await handler.handleSyncStatus();
      const totalCount = recentResult.total;
      const lastSync = syncStatus.lastSyncTime || 'Never';

      // Build the HTML
      const html = buildHtml({
        recentMemories: recentResult.memories,
        todayMemories: todayResult.memories,
        activeProjects,
        pendingActions,
        crossAgent,
        totalCount,
        lastSync,
        generatedAt: now.toISOString(),
      });

      res.type('html').send(html);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // JSON API endpoint (same data the MCP tool returns)
  app.get('/api/checkin', async (req, res) => {
    try {
      const limit = parseInt(req.query['limit'] as string) || 5;
      const since = req.query['since'] as string | undefined;

      const now = new Date();
      const todayStart = since || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      const recentResult = await handler.handleList({ sort: 'newest', limit, offset: 0 });
      const todayResult = await handler.handleList({ sort: 'newest', limit: 50, offset: 0, filters: { since: todayStart } });
      const allTags = await store.getAllTags();
      const activeProjects = allTags.filter((t) => t.count > 3);

      const procedureResult = await handler.handleList({ sort: 'newest', limit: 20, offset: 0, filters: { types: ['procedure'] } });
      const actionTagResult = await handler.handleList({ sort: 'newest', limit: 20, offset: 0, filters: { tags: ['action', 'action-item', 'todo', 'task'] } });
      const actionIds = new Set<string>();
      const pendingActions = [...procedureResult.memories, ...actionTagResult.memories].filter((m) => {
        if (actionIds.has(m.id)) return false;
        actionIds.add(m.id);
        return true;
      });

      const allRecent = await handler.handleList({ sort: 'newest', limit: 20, offset: 0 });
      const crossAgent = allRecent.memories.filter((m) => m.source?.agent && m.source.agent !== 'local');

      const syncStatus = await handler.handleSyncStatus();

      res.json({
        recentMemories: recentResult.memories.slice(0, limit),
        todayMemories: todayResult.memories,
        activeProjects,
        pendingActions,
        crossAgentActivity: crossAgent,
        totalCount: recentResult.total,
        lastSyncTime: syncStatus.lastSyncTime,
        generatedAt: now.toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}

// ─── HTML Builder ──────────────────────────────────────────────────────────────

interface BriefingData {
  recentMemories: any[];
  todayMemories: any[];
  activeProjects: Array<{ tag: string; count: number }>;
  pendingActions: any[];
  crossAgent: any[];
  totalCount: number;
  lastSync: string;
  generatedAt: string;
}

function buildHtml(data: BriefingData): string {
  const recentCards = data.recentMemories.map((m) => `
    <div class="card">
      <div class="card-header">
        <span class="badge badge-${m.type}">${m.type}</span>
        <span class="time">${timeAgo(m.createdAt)}</span>
      </div>
      <div class="card-title">${esc(m.title || m.content.slice(0, 60))}</div>
      <div class="card-content">${esc(m.content.slice(0, 200))}${m.content.length > 200 ? '...' : ''}</div>
      ${m.tags?.length ? `<div class="card-tags">${m.tags.map((t: string) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${m.source?.agent ? `<div class="agent-badge">via ${esc(m.source.agent)}</div>` : ''}
    </div>
  `).join('');

  const todaySection = data.todayMemories.length > 0
    ? `<div class="stat-highlight">${data.todayMemories.length} memories created today</div>`
    : `<div class="stat-muted">No memories created today yet</div>`;

  const projectCards = data.activeProjects.slice(0, 8).map((p) => `
    <div class="project-item">
      <span class="project-name">${esc(p.tag)}</span>
      <span class="project-count">${p.count} memories</span>
    </div>
  `).join('');

  const actionCards = data.pendingActions.slice(0, 5).map((m) => `
    <div class="action-item">
      <div class="action-title">${esc(m.title || m.content.slice(0, 80))}</div>
      <div class="action-meta">${m.type} | ${timeAgo(m.createdAt)}</div>
    </div>
  `).join('');

  const crossAgentCards = data.crossAgent.slice(0, 5).map((m) => `
    <div class="agent-item">
      <span class="agent-name">${esc(m.source?.agent || 'unknown')}</span>
      <span class="agent-content">${esc(m.title || m.content.slice(0, 60))}</span>
      <span class="time">${timeAgo(m.createdAt)}</span>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SharedBrain - Morning Briefing</title>
  <meta http-equiv="refresh" content="30">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #232F3E;
      color: #F5F3EF;
      padding: 2rem;
      line-height: 1.6;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      color: #FF6100;
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }
    .subtitle {
      color: #F5F3EF99;
      font-size: 0.9rem;
      margin-bottom: 2rem;
    }
    .grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 2rem;
    }
    @media (max-width: 800px) {
      .grid { grid-template-columns: 1fr; }
    }
    .section {
      margin-bottom: 2rem;
    }
    .section-title {
      color: #FF6100;
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid #FF610033;
    }
    .card {
      background: #2E3B4E;
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 0.75rem;
      border-left: 3px solid #FF6100;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .card-title {
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .card-content {
      color: #F5F3EFaa;
      font-size: 0.85rem;
    }
    .card-tags {
      margin-top: 0.5rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .badge {
      font-size: 0.7rem;
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .badge-fact { background: #3B82F6; color: white; }
    .badge-decision { background: #8B5CF6; color: white; }
    .badge-procedure { background: #10B981; color: white; }
    .badge-preference { background: #F59E0B; color: black; }
    .badge-reference { background: #6366F1; color: white; }
    .badge-context { background: #64748B; color: white; }
    .tag {
      font-size: 0.7rem;
      padding: 0.1rem 0.4rem;
      background: #FF610033;
      color: #FF6100;
      border-radius: 4px;
    }
    .time {
      font-size: 0.75rem;
      color: #F5F3EF66;
    }
    .agent-badge {
      font-size: 0.7rem;
      color: #FF6100;
      margin-top: 0.3rem;
      font-style: italic;
    }
    .stat-highlight {
      background: #FF610022;
      border: 1px solid #FF610044;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      text-align: center;
      font-weight: 600;
      color: #FF6100;
      margin-bottom: 1rem;
    }
    .stat-muted {
      color: #F5F3EF66;
      text-align: center;
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    .project-item {
      display: flex;
      justify-content: space-between;
      padding: 0.5rem 0;
      border-bottom: 1px solid #F5F3EF11;
    }
    .project-name { font-weight: 500; }
    .project-count { color: #FF6100; font-size: 0.85rem; }
    .action-item {
      background: #2E3B4E;
      border-radius: 6px;
      padding: 0.75rem;
      margin-bottom: 0.5rem;
      border-left: 3px solid #10B981;
    }
    .action-title { font-size: 0.9rem; }
    .action-meta { font-size: 0.75rem; color: #F5F3EF66; margin-top: 0.25rem; }
    .agent-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid #F5F3EF11;
    }
    .agent-name {
      background: #FF610033;
      color: #FF6100;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .agent-content { flex: 1; font-size: 0.85rem; }
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid #F5F3EF22;
      display: flex;
      justify-content: space-between;
      color: #F5F3EF66;
      font-size: 0.8rem;
    }
    .empty { color: #F5F3EF44; font-style: italic; padding: 1rem 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>SharedBrain Briefing</h1>
    <div class="subtitle">Generated ${new Date(data.generatedAt).toLocaleString()} | ${data.totalCount} total memories | Last sync: ${data.lastSync === 'Never' ? 'Never' : timeAgo(data.lastSync)} | Auto-refreshes every 30s</div>

    ${todaySection}

    <div class="grid">
      <div class="main">
        <div class="section">
          <div class="section-title">Recent Memories</div>
          ${recentCards || '<div class="empty">No memories stored yet.</div>'}
        </div>

        ${data.crossAgent.length > 0 ? `
        <div class="section">
          <div class="section-title">Cross-Agent Activity</div>
          ${crossAgentCards}
        </div>
        ` : ''}
      </div>

      <div class="sidebar">
        <div class="section">
          <div class="section-title">Active Projects</div>
          ${projectCards || '<div class="empty">No active projects yet (need tags with 3+ memories).</div>'}
        </div>

        <div class="section">
          <div class="section-title">Pending Actions</div>
          ${actionCards || '<div class="empty">No pending action items.</div>'}
        </div>
      </div>
    </div>

    <div class="footer">
      <span>SharedBrain v0.1 | Vectors: ${data.totalCount}</span>
      <span>Page auto-refreshes every 30 seconds</span>
    </div>
  </div>
</body>
</html>`;
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  if (diffMs < 604_800_000) return `${Math.floor(diffMs / 86_400_000)}d ago`;
  return new Date(dateStr).toLocaleDateString();
}
