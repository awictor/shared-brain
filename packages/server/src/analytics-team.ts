/**
 * Team Analytics Dashboard — Manager persona visibility into team knowledge activity
 *
 * Provides:
 * 1. Contribution Metrics (per-user bar chart)
 * 2. Knowledge Coverage (tags + types distribution)
 * 3. Growth Trend (14-day memory additions)
 * 4. Cross-Pollination Score (knowledge flow between users)
 * 5. Team Health Indicators (active users, staleness, etc.)
 */

import type { Application } from 'express';

export function registerTeamAnalytics(app: Application): void {
  // ─── API endpoints ──────────────────────────────────────────────────────

  // Get contribution metrics (per-user memory counts + last active)
  app.get('/api/analytics/team/contributions', async (_req, res) => {
    try {
      const store = (app as any).locals.store;
      if (!store?.db) {
        return res.status(500).json({ error: 'Store not available' });
      }

      // Get per-user stats from memories table
      const userRows = store.db.exec(`
        SELECT
          author_id as userId,
          author_name as userName,
          COUNT(*) as allTimeMemories,
          MAX(created_at) as lastActive
        FROM memories
        WHERE deleted = 0
        GROUP BY author_id, author_name
        ORDER BY allTimeMemories DESC
      `);

      // Get this-week counts
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const weekRows = store.db.exec(`
        SELECT
          author_id as userId,
          COUNT(*) as weekMemories
        FROM memories
        WHERE deleted = 0 AND created_at >= ?
        GROUP BY author_id
      `, [weekAgo]);

      // Build week map
      const weekMap = new Map<string, number>();
      if (weekRows.length && weekRows[0].values.length) {
        for (const row of weekRows[0].values) {
          const cols = weekRows[0].columns;
          const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
          weekMap.set(r.userId, r.weekMemories);
        }
      }

      // Get search counts from audit log (if available)
      const searchRows = store.db.exec(`
        SELECT
          user_id as userId,
          COUNT(*) as searches
        FROM audit_log
        WHERE action = 'search'
        GROUP BY user_id
      `);

      const searchMap = new Map<string, number>();
      if (searchRows.length && searchRows[0].values.length) {
        for (const row of searchRows[0].values) {
          const cols = searchRows[0].columns;
          const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
          searchMap.set(r.userId, r.searches);
        }
      }

      // Combine data
      const contributions: any[] = [];
      if (userRows.length && userRows[0].values.length) {
        for (const row of userRows[0].values) {
          const cols = userRows[0].columns;
          const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
          contributions.push({
            userId: r.userId,
            userName: r.userName,
            allTimeMemories: r.allTimeMemories,
            weekMemories: weekMap.get(r.userId) || 0,
            searches: searchMap.get(r.userId) || 0,
            lastActive: r.lastActive,
          });
        }
      }

      res.json({ contributions });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch contributions' });
    }
  });

  // Get knowledge coverage (tags + types distribution)
  app.get('/api/analytics/team/coverage', async (_req, res) => {
    try {
      const store = (app as any).locals.store;
      if (!store?.db) {
        return res.status(500).json({ error: 'Store not available' });
      }

      // Get all tags and their counts
      const tagRows = store.db.exec(`
        SELECT tags_json FROM memories WHERE deleted = 0
      `);

      const tagCounts = new Map<string, number>();
      if (tagRows.length && tagRows[0].values.length) {
        for (const row of tagRows[0].values) {
          const tags: string[] = JSON.parse((row as any)[0] || '[]');
          for (const tag of tags) {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
        }
      }

      // Categorize tags by coverage
      const wellCovered: any[] = [];
      const sparse: any[] = [];
      for (const [tag, count] of tagCounts.entries()) {
        if (count >= 5) {
          wellCovered.push({ tag, count, status: 'well-covered' });
        } else if (count < 3) {
          sparse.push({ tag, count, status: 'sparse' });
        }
      }

      // Get type distribution
      const typeRows = store.db.exec(`
        SELECT
          type,
          COUNT(*) as count
        FROM memories
        WHERE deleted = 0
        GROUP BY type
        ORDER BY count DESC
      `);

      const types: any[] = [];
      if (typeRows.length && typeRows[0].values.length) {
        for (const row of typeRows[0].values) {
          const cols = typeRows[0].columns;
          const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
          types.push({ type: r.type, count: r.count });
        }
      }

      res.json({
        wellCovered: wellCovered.sort((a, b) => b.count - a.count).slice(0, 10),
        sparse: sparse.sort((a, b) => b.count - a.count).slice(0, 10),
        types,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch coverage' });
    }
  });

  // Get growth trend (memories per day for last 14 days)
  app.get('/api/analytics/team/growth', async (_req, res) => {
    try {
      const store = (app as any).locals.store;
      if (!store?.db) {
        return res.status(500).json({ error: 'Store not available' });
      }

      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const growthRows = store.db.exec(`
        SELECT
          DATE(created_at) as date,
          COUNT(*) as count
        FROM memories
        WHERE deleted = 0 AND created_at >= ?
        GROUP BY DATE(created_at)
        ORDER BY date ASC
      `, [twoWeeksAgo]);

      const growth: any[] = [];
      if (growthRows.length && growthRows[0].values.length) {
        for (const row of growthRows[0].values) {
          const cols = growthRows[0].columns;
          const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
          growth.push({ date: r.date, count: r.count });
        }
      }

      // Fill in missing days with 0
      const allDays: any[] = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        const existing = growth.find(g => g.date === dateStr);
        allDays.push({ date: dateStr, count: existing?.count || 0 });
      }

      res.json({ growth: allDays });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch growth' });
    }
  });

  // Get cross-pollination score
  app.get('/api/analytics/team/cross-pollination', async (_req, res) => {
    try {
      const store = (app as any).locals.store;
      if (!store?.db) {
        return res.status(500).json({ error: 'Store not available' });
      }

      // Calculate % of searches that return another user's memory
      // This requires audit log with search results — fallback to simpler metric

      // Get total memories and unique authors
      const totalRows = store.db.exec(`SELECT COUNT(*) as total FROM memories WHERE deleted = 0`);
      const total = totalRows[0]?.values[0]?.[0] as number ?? 0;

      const authorRows = store.db.exec(`
        SELECT COUNT(DISTINCT author_id) as authors FROM memories WHERE deleted = 0
      `);
      const authors = authorRows[0]?.values[0]?.[0] as number ?? 0;

      // Get top shared memories (simplified: most tagged/related memories)
      const sharedRows = store.db.exec(`
        SELECT
          id,
          title,
          content,
          author_name,
          tags_json,
          created_at
        FROM memories
        WHERE deleted = 0
        ORDER BY LENGTH(tags_json) DESC
        LIMIT 10
      `);

      const topShared: any[] = [];
      if (sharedRows.length && sharedRows[0].values.length) {
        for (const row of sharedRows[0].values) {
          const cols = sharedRows[0].columns;
          const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
          const tags = JSON.parse(r.tags_json || '[]');
          topShared.push({
            id: r.id,
            title: r.title || r.content.slice(0, 50),
            authorName: r.author_name,
            tags: tags.length,
            createdAt: r.created_at,
          });
        }
      }

      // Calculate cross-pollination score (% of memories that are discoverable by multiple users)
      // Heuristic: memories with tags are more discoverable
      const taggedRows = store.db.exec(`
        SELECT COUNT(*) as tagged FROM memories WHERE deleted = 0 AND tags_json != '[]'
      `);
      const tagged = taggedRows[0]?.values[0]?.[0] as number ?? 0;
      const crossPollinationScore = total > 0 ? Math.round((tagged / total) * 100) : 0;

      res.json({
        crossPollinationScore,
        totalMemories: total,
        uniqueAuthors: authors,
        taggedMemories: tagged,
        topShared,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch cross-pollination' });
    }
  });

  // Get team health indicators
  app.get('/api/analytics/team/health', async (_req, res) => {
    try {
      const store = (app as any).locals.store;
      if (!store?.db) {
        return res.status(500).json({ error: 'Store not available' });
      }

      // Active users (last 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const activeRows = store.db.exec(`
        SELECT COUNT(DISTINCT author_id) as active FROM memories
        WHERE deleted = 0 AND created_at >= ?
      `, [weekAgo]);
      const activeUsers = activeRows[0]?.values[0]?.[0] as number ?? 0;

      // Total users
      const totalRows = store.db.exec(`
        SELECT COUNT(DISTINCT author_id) as total FROM memories WHERE deleted = 0
      `);
      const totalUsers = totalRows[0]?.values[0]?.[0] as number ?? 0;

      // Avg memories per user
      const memoryRows = store.db.exec(`SELECT COUNT(*) as total FROM memories WHERE deleted = 0`);
      const totalMemories = memoryRows[0]?.values[0]?.[0] as number ?? 0;
      const avgMemoriesPerUser = totalUsers > 0 ? Math.round(totalMemories / totalUsers) : 0;

      // Oldest memory without update (staleness)
      const staleRows = store.db.exec(`
        SELECT
          id,
          title,
          content,
          author_name,
          created_at,
          updated_at
        FROM memories
        WHERE deleted = 0
        ORDER BY updated_at ASC
        LIMIT 1
      `);

      let oldestMemory: any = null;
      if (staleRows.length && staleRows[0].values.length) {
        const row = staleRows[0].values[0];
        const cols = staleRows[0].columns;
        const r = Object.fromEntries(cols.map((c: string, i: number) => [c, row[i]])) as any;
        const daysSinceUpdate = Math.floor((Date.now() - new Date(r.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        oldestMemory = {
          id: r.id,
          title: r.title || r.content.slice(0, 50),
          authorName: r.author_name,
          daysSinceUpdate,
        };
      }

      res.json({
        activeUsers,
        totalUsers,
        avgMemoriesPerUser,
        oldestMemory,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch health indicators' });
    }
  });

  // ─── Dashboard HTML ─────────────────────────────────────────────────────

  app.get('/analytics/team', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(DASHBOARD_HTML);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Team Analytics — SharedBrain</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #1a2332;
    color: #F5F3EF;
    line-height: 1.6;
    min-height: 100vh;
    padding: 24px;
  }
  .container { max-width: 1400px; margin: 0 auto; }

  h1 {
    color: #FF6100;
    font-size: 32px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .subtitle {
    color: #8899AA;
    margin-bottom: 32px;
    font-size: 14px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 24px;
    margin-bottom: 24px;
  }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: 1fr 1fr 1fr; }
  @media (max-width: 768px) {
    .grid, .grid-2, .grid-3 { grid-template-columns: 1fr; }
  }

  .card {
    background: #232F3E;
    border: 1px solid #344559;
    border-radius: 12px;
    padding: 20px;
    position: relative;
    overflow: hidden;
  }
  .card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(90deg, #FF6100, #FF8C42);
  }
  .card h2 {
    color: #FF6100;
    font-size: 16px;
    margin-bottom: 16px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .stat-box {
    text-align: center;
    padding: 16px;
    background: #1a2332;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .stat-value {
    font-size: 36px;
    font-weight: 700;
    color: #FF6100;
    margin-bottom: 4px;
  }
  .stat-label {
    font-size: 13px;
    color: #8899AA;
    text-transform: uppercase;
  }

  .bar-chart {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 12px;
  }
  .bar-item {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bar-label {
    min-width: 120px;
    font-size: 13px;
    color: #F5F3EF;
    font-weight: 500;
  }
  .bar-track {
    flex: 1;
    height: 24px;
    background: #1a2332;
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  .bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #FF6100, #FF8C42);
    border-radius: 4px;
    transition: width 0.5s ease;
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #FFF;
  }
  .bar-value {
    min-width: 40px;
    text-align: right;
    font-size: 13px;
    color: #8899AA;
    font-weight: 600;
  }

  .timeline-chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 120px;
    margin-top: 16px;
  }
  .timeline-bar {
    flex: 1;
    background: linear-gradient(180deg, #FF8C42, #FF6100);
    border-radius: 3px 3px 0 0;
    position: relative;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .timeline-bar:hover {
    opacity: 0.8;
  }
  .timeline-bar::after {
    content: attr(data-count);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: #232F3E;
    color: #F5F3EF;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .timeline-bar:hover::after {
    opacity: 1;
  }

  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .tag {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tag.well-covered {
    background: rgba(76, 175, 80, 0.2);
    color: #81C784;
    border: 1px solid rgba(76, 175, 80, 0.3);
  }
  .tag.sparse {
    background: rgba(255, 193, 7, 0.2);
    color: #FFD54F;
    border: 1px solid rgba(255, 193, 7, 0.3);
  }
  .tag-count {
    background: rgba(0, 0, 0, 0.2);
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
  }

  .type-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }
  .type-item {
    text-align: center;
    padding: 12px;
    background: #1a2332;
    border-radius: 8px;
  }
  .type-name {
    font-size: 11px;
    text-transform: uppercase;
    color: #8899AA;
    margin-bottom: 4px;
  }
  .type-count {
    font-size: 24px;
    font-weight: 700;
    color: #FF6100;
  }

  .health-indicator {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px;
    background: #1a2332;
    border-radius: 8px;
    margin-bottom: 8px;
  }
  .health-label {
    font-size: 13px;
    color: #8899AA;
  }
  .health-value {
    font-size: 16px;
    font-weight: 600;
    color: #FF6100;
  }

  .empty-state {
    text-align: center;
    padding: 40px;
    color: #8899AA;
    font-size: 14px;
  }

  .loading {
    text-align: center;
    padding: 20px;
    color: #8899AA;
  }
  .spinner {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 2px solid #344559;
    border-top-color: #FF6100;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .refresh-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #FF6100;
    border: none;
    color: #FFF;
    font-size: 24px;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    transition: transform 0.2s, background 0.2s;
  }
  .refresh-btn:hover {
    background: #e55800;
    transform: scale(1.05);
  }
  .refresh-btn:active {
    transform: scale(0.95);
  }
</style>
</head>
<body>
<div class="container">
  <h1>📊 Team Analytics</h1>
  <div class="subtitle">Manager dashboard for team knowledge activity</div>

  <!-- Team Health Indicators -->
  <div class="grid grid-3">
    <div class="card">
      <div class="stat-box">
        <div class="stat-value" id="activeUsers">-</div>
        <div class="stat-label">Active Users (7d)</div>
      </div>
    </div>
    <div class="card">
      <div class="stat-box">
        <div class="stat-value" id="avgMemories">-</div>
        <div class="stat-label">Avg Memories/User</div>
      </div>
    </div>
    <div class="card">
      <div class="stat-box">
        <div class="stat-value" id="crossPollination">-</div>
        <div class="stat-label">Cross-Pollination Score</div>
      </div>
    </div>
  </div>

  <!-- Contribution Metrics -->
  <div class="grid grid-2">
    <div class="card">
      <h2>📈 Contribution Metrics</h2>
      <div id="contributionsChart" class="loading">
        <div class="spinner"></div>
      </div>
    </div>

    <!-- Growth Trend -->
    <div class="card">
      <h2>📅 Growth Trend (14 days)</h2>
      <div id="growthChart" class="loading">
        <div class="spinner"></div>
      </div>
    </div>
  </div>

  <!-- Knowledge Coverage -->
  <div class="grid">
    <div class="card">
      <h2>🎯 Knowledge Coverage — Tags</h2>
      <div id="tagsChart" class="loading">
        <div class="spinner"></div>
      </div>
    </div>

    <div class="card">
      <h2>📚 Memory Types Distribution</h2>
      <div id="typesChart" class="loading">
        <div class="spinner"></div>
      </div>
    </div>
  </div>

  <!-- Cross-Pollination -->
  <div class="card">
    <h2>🔄 Cross-Pollination — Top Shared Memories</h2>
    <div id="sharedChart" class="loading">
      <div class="spinner"></div>
    </div>
  </div>

  <!-- Team Health Details -->
  <div class="card">
    <h2>💚 Team Health Details</h2>
    <div id="healthDetails" class="loading">
      <div class="spinner"></div>
    </div>
  </div>
</div>

<button class="refresh-btn" onclick="loadAll()" title="Refresh">↻</button>

<script>
let contributionsData = null;
let growthData = null;
let coverageData = null;
let pollinationData = null;
let healthData = null;

async function loadContributions() {
  try {
    const res = await fetch('/api/analytics/team/contributions');
    const data = await res.json();
    contributionsData = data;

    const container = document.getElementById('contributionsChart');
    if (!data.contributions || data.contributions.length === 0) {
      container.innerHTML = '<div class="empty-state">No contributions yet</div>';
      return;
    }

    const maxMemories = Math.max(...data.contributions.map(c => c.allTimeMemories));
    const html = '<div class="bar-chart">' + data.contributions.map(c => {
      const pct = maxMemories > 0 ? (c.allTimeMemories / maxMemories * 100) : 0;
      return \`
        <div class="bar-item">
          <div class="bar-label" title="\${c.userId}">\${c.userName}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width: \${pct}%">
              <span style="font-size:10px">Week: \${c.weekMemories}</span>
            </div>
          </div>
          <div class="bar-value">\${c.allTimeMemories}</div>
        </div>
      \`;
    }).join('') + '</div>';
    container.innerHTML = html;
  } catch (err) {
    document.getElementById('contributionsChart').innerHTML = '<div class="empty-state">Error loading data</div>';
  }
}

async function loadGrowth() {
  try {
    const res = await fetch('/api/analytics/team/growth');
    const data = await res.json();
    growthData = data;

    const container = document.getElementById('growthChart');
    if (!data.growth || data.growth.length === 0) {
      container.innerHTML = '<div class="empty-state">No growth data</div>';
      return;
    }

    const maxCount = Math.max(...data.growth.map(g => g.count), 1);
    const html = '<div class="timeline-chart">' + data.growth.map(g => {
      const heightPct = (g.count / maxCount * 100);
      const date = new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return \`<div class="timeline-bar" style="height: \${heightPct}%" data-count="\${g.count} on \${date}" title="\${date}: \${g.count}"></div>\`;
    }).join('') + '</div>';
    container.innerHTML = html;
  } catch (err) {
    document.getElementById('growthChart').innerHTML = '<div class="empty-state">Error loading data</div>';
  }
}

async function loadCoverage() {
  try {
    const res = await fetch('/api/analytics/team/coverage');
    const data = await res.json();
    coverageData = data;

    // Tags
    const tagsContainer = document.getElementById('tagsChart');
    if ((!data.wellCovered || data.wellCovered.length === 0) && (!data.sparse || data.sparse.length === 0)) {
      tagsContainer.innerHTML = '<div class="empty-state">No tags yet</div>';
    } else {
      const wellHtml = data.wellCovered.map(t =>
        \`<div class="tag well-covered">✓ \${t.tag}<span class="tag-count">\${t.count}</span></div>\`
      ).join('');
      const sparseHtml = data.sparse.map(t =>
        \`<div class="tag sparse">⚠ \${t.tag}<span class="tag-count">\${t.count}</span></div>\`
      ).join('');
      tagsContainer.innerHTML = '<div class="tag-cloud">' + wellHtml + sparseHtml + '</div>';
    }

    // Types
    const typesContainer = document.getElementById('typesChart');
    if (!data.types || data.types.length === 0) {
      typesContainer.innerHTML = '<div class="empty-state">No memory types yet</div>';
    } else {
      const html = '<div class="type-grid">' + data.types.map(t =>
        \`<div class="type-item">
          <div class="type-name">\${t.type}</div>
          <div class="type-count">\${t.count}</div>
        </div>\`
      ).join('') + '</div>';
      typesContainer.innerHTML = html;
    }
  } catch (err) {
    document.getElementById('tagsChart').innerHTML = '<div class="empty-state">Error loading data</div>';
    document.getElementById('typesChart').innerHTML = '<div class="empty-state">Error loading data</div>';
  }
}

async function loadPollination() {
  try {
    const res = await fetch('/api/analytics/team/cross-pollination');
    const data = await res.json();
    pollinationData = data;

    document.getElementById('crossPollination').textContent = data.crossPollinationScore + '%';

    const container = document.getElementById('sharedChart');
    if (!data.topShared || data.topShared.length === 0) {
      container.innerHTML = '<div class="empty-state">No shared memories yet</div>';
      return;
    }

    const html = '<div class="bar-chart">' + data.topShared.map(m => {
      return \`
        <div class="health-indicator">
          <div>
            <div style="font-weight:600;color:#F5F3EF;margin-bottom:2px;">\${m.title}</div>
            <div style="font-size:11px;color:#8899AA;">by \${m.authorName} • \${m.tags} tags</div>
          </div>
          <div class="health-value">\${new Date(m.createdAt).toLocaleDateString()}</div>
        </div>
      \`;
    }).join('') + '</div>';
    container.innerHTML = html;
  } catch (err) {
    document.getElementById('sharedChart').innerHTML = '<div class="empty-state">Error loading data</div>';
  }
}

async function loadHealth() {
  try {
    const res = await fetch('/api/analytics/team/health');
    const data = await res.json();
    healthData = data;

    document.getElementById('activeUsers').textContent = \`\${data.activeUsers}/\${data.totalUsers}\`;
    document.getElementById('avgMemories').textContent = data.avgMemoriesPerUser;

    const container = document.getElementById('healthDetails');
    const html = \`
      <div class="health-indicator">
        <div class="health-label">Active Users (Last 7 Days)</div>
        <div class="health-value">\${data.activeUsers} / \${data.totalUsers}</div>
      </div>
      <div class="health-indicator">
        <div class="health-label">Average Memories per User</div>
        <div class="health-value">\${data.avgMemoriesPerUser}</div>
      </div>
      \${data.oldestMemory ? \`
        <div class="health-indicator">
          <div>
            <div class="health-label">Oldest Memory Without Update</div>
            <div style="font-size:12px;color:#8899AA;margin-top:2px;">\${data.oldestMemory.title} by \${data.oldestMemory.authorName}</div>
          </div>
          <div class="health-value">\${data.oldestMemory.daysSinceUpdate}d</div>
        </div>
      \` : ''}
    \`;
    container.innerHTML = html;
  } catch (err) {
    document.getElementById('healthDetails').innerHTML = '<div class="empty-state">Error loading data</div>';
  }
}

async function loadAll() {
  await Promise.all([
    loadContributions(),
    loadGrowth(),
    loadCoverage(),
    loadPollination(),
    loadHealth(),
  ]);
}

// Initial load
loadAll();

// Auto-refresh every 30 seconds
setInterval(loadAll, 30000);
</script>
</body>
</html>
`;
