/**
 * browse.ts — "Browse Knowledge" discovery page
 *
 * Provides five ways to discover what's in the brain:
 * 1. Tag Cloud — all tags sized by frequency
 * 2. Topic Clusters — memory types with horizontal bar charts
 * 3. Timeline — chronological memory feed
 * 4. Contributors — author leaderboard
 * 5. Recent Activity — last 20 memories
 *
 * All data fetched via POST /mcp (memory_list, sync_status).
 */

import type { Application } from 'express';

export function registerBrowse(app: Application): void {
  app.get('/browse', (_req, res) => {
    res.send(BROWSE_HTML);
  });
}

const BROWSE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Browse Knowledge — SharedBrain</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a2332;
      color: #F5F3EF;
      line-height: 1.6;
      overflow-x: hidden;
    }

    .header {
      background: #232F3E;
      padding: 1.5rem 2rem;
      border-bottom: 2px solid #FF6100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }

    .header h1 {
      font-size: 2rem;
      color: #FF6100;
      margin-bottom: 0.5rem;
    }

    .header p {
      color: #8a9ba8;
      font-size: 0.95rem;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(600px, 1fr));
      gap: 2rem;
      margin-bottom: 2rem;
    }

    @media (max-width: 768px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    .card {
      background: #232F3E;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(255,97,0,0.2);
    }

    .card h2 {
      color: #FF6100;
      font-size: 1.5rem;
      margin-bottom: 1rem;
      border-bottom: 2px solid #FF6100;
      padding-bottom: 0.5rem;
    }

    .tag-cloud {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
      justify-content: center;
      padding: 1rem 0;
      min-height: 200px;
    }

    .tag {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: rgba(255,97,0,0.1);
      border: 1px solid #FF6100;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s;
      color: #F5F3EF;
    }

    .tag:hover {
      background: #FF6100;
      color: #232F3E;
      transform: scale(1.05);
    }

    .tag.active {
      background: #FF6100;
      color: #232F3E;
      font-weight: 600;
    }

    .topic-clusters {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .topic-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .topic-label {
      min-width: 120px;
      font-weight: 500;
      color: #8a9ba8;
      text-transform: capitalize;
    }

    .topic-bar-container {
      flex: 1;
      height: 32px;
      background: rgba(255,97,0,0.1);
      border-radius: 6px;
      overflow: hidden;
      position: relative;
    }

    .topic-bar {
      height: 100%;
      background: linear-gradient(90deg, #FF6100, #ff8533);
      transition: width 0.6s ease-out;
      display: flex;
      align-items: center;
      padding: 0 0.75rem;
      color: #232F3E;
      font-weight: 600;
      font-size: 0.9rem;
    }

    .timeline {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      max-height: 600px;
      overflow-y: auto;
      padding-right: 0.5rem;
    }

    .timeline::-webkit-scrollbar {
      width: 6px;
    }

    .timeline::-webkit-scrollbar-track {
      background: rgba(255,97,0,0.1);
      border-radius: 3px;
    }

    .timeline::-webkit-scrollbar-thumb {
      background: #FF6100;
      border-radius: 3px;
    }

    .timeline-item {
      display: flex;
      gap: 1rem;
      padding: 0.75rem;
      background: rgba(255,97,0,0.05);
      border-left: 3px solid #FF6100;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .timeline-item:hover {
      background: rgba(255,97,0,0.15);
      transform: translateX(4px);
    }

    .timeline-dot {
      width: 12px;
      height: 12px;
      background: #FF6100;
      border-radius: 50%;
      margin-top: 0.25rem;
      flex-shrink: 0;
    }

    .timeline-content {
      flex: 1;
    }

    .timeline-title {
      font-weight: 600;
      color: #F5F3EF;
      margin-bottom: 0.25rem;
    }

    .timeline-meta {
      font-size: 0.85rem;
      color: #8a9ba8;
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .timeline-body {
      margin-top: 0.5rem;
      padding: 0.75rem;
      background: rgba(0,0,0,0.2);
      border-radius: 4px;
      font-size: 0.9rem;
      color: #c5d1d9;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease-out;
    }

    .timeline-item.expanded .timeline-body {
      max-height: 500px;
    }

    .contributors {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .contributor-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.5rem;
      background: rgba(255,97,0,0.05);
      border-radius: 6px;
      transition: background 0.2s;
    }

    .contributor-row:hover {
      background: rgba(255,97,0,0.15);
    }

    .contributor-rank {
      width: 32px;
      height: 32px;
      background: #FF6100;
      color: #232F3E;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    .contributor-name {
      flex: 1;
      font-weight: 500;
      color: #F5F3EF;
    }

    .contributor-count {
      font-weight: 600;
      color: #FF6100;
      font-size: 1.1rem;
    }

    .activity-feed {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      max-height: 400px;
      overflow-y: auto;
      padding-right: 0.5rem;
    }

    .activity-item {
      display: flex;
      gap: 0.75rem;
      padding: 0.5rem;
      background: rgba(255,97,0,0.05);
      border-radius: 6px;
      font-size: 0.9rem;
      transition: background 0.2s;
    }

    .activity-item:hover {
      background: rgba(255,97,0,0.15);
    }

    .activity-badge {
      padding: 0.25rem 0.5rem;
      background: #FF6100;
      color: #232F3E;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.75rem;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .activity-text {
      flex: 1;
      color: #F5F3EF;
    }

    .activity-time {
      color: #8a9ba8;
      font-size: 0.8rem;
      white-space: nowrap;
    }

    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      color: #8a9ba8;
      font-size: 1.1rem;
    }

    .error {
      background: rgba(255,0,0,0.1);
      border: 1px solid #ff4444;
      color: #ff6b6b;
      padding: 1rem;
      border-radius: 6px;
      margin: 1rem 0;
    }

    .empty {
      text-align: center;
      color: #8a9ba8;
      padding: 2rem;
      font-style: italic;
    }

    .filter-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: #FF6100;
      color: #232F3E;
      border-radius: 6px;
      font-weight: 600;
      margin-bottom: 1rem;
      cursor: pointer;
      transition: background 0.2s;
    }

    .filter-badge:hover {
      background: #ff8533;
    }

    .filter-badge::after {
      content: '✕';
      font-size: 1.2rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Browse Knowledge</h1>
    <p>Discover what's in the brain without knowing what to search for</p>
  </div>

  <div class="container">
    <div id="filterBadge" style="display: none;"></div>

    <div class="grid">
      <!-- Tag Cloud -->
      <div class="card">
        <h2>Tag Cloud</h2>
        <div id="tagCloud" class="tag-cloud">
          <div class="loading">Loading tags...</div>
        </div>
      </div>

      <!-- Topic Clusters -->
      <div class="card">
        <h2>Topic Clusters</h2>
        <div id="topicClusters" class="topic-clusters">
          <div class="loading">Loading types...</div>
        </div>
      </div>
    </div>

    <!-- Timeline -->
    <div class="card" style="grid-column: 1 / -1;">
      <h2>Timeline</h2>
      <div id="timeline" class="timeline">
        <div class="loading">Loading memories...</div>
      </div>
    </div>

    <div class="grid">
      <!-- Contributors -->
      <div class="card">
        <h2>Contributors</h2>
        <div id="contributors" class="contributors">
          <div class="loading">Loading authors...</div>
        </div>
      </div>

      <!-- Recent Activity -->
      <div class="card">
        <h2>Recent Activity</h2>
        <div id="activity" class="activity-feed">
          <div class="loading">Loading activity...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let allMemories = [];
    let filteredMemories = [];
    let currentFilter = null;

    // Fetch memories via MCP
    async function fetchMemories() {
      try {
        const response = await fetch('/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'memory_list',
              arguments: { limit: 1000, scope: { personal: true, org: true } }
            }
          })
        });

        const rawText = await response.text();
        let data;
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('text/event-stream')) {
          for (const line of rawText.split(String.fromCharCode(10))) {
            if (line.startsWith('data: ')) { try { data = JSON.parse(line.slice(6)); } catch {} }
          }
        } else {
          data = JSON.parse(rawText);
        }

        if (!data || data.error) {
          throw new Error(data?.error?.message || 'Failed to fetch memories');
        }

        const result = JSON.parse(data.result.content[0].text);
        allMemories = result.memories || [];
        filteredMemories = allMemories;

        renderAll();
      } catch (err) {
        showError(err.message);
      }
    }

    function renderAll() {
      renderTagCloud();
      renderTopicClusters();
      renderTimeline();
      renderContributors();
      renderActivity();
    }

    function renderTagCloud() {
      const tagCloud = document.getElementById('tagCloud');

      if (filteredMemories.length === 0) {
        tagCloud.innerHTML = '<div class="empty">No tags found</div>';
        return;
      }

      // Count tag frequencies
      const tagCounts = new Map();
      for (const memory of filteredMemories) {
        for (const tag of memory.tags || []) {
          tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        }
      }

      if (tagCounts.size === 0) {
        tagCloud.innerHTML = '<div class="empty">No tags in memories</div>';
        return;
      }

      // Scale font sizes
      const counts = [...tagCounts.values()];
      const maxCount = Math.max(...counts);
      const minCount = Math.min(...counts);

      const tags = [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([tag, count]) => {
          const scale = minCount === maxCount ? 1 : (count - minCount) / (maxCount - minCount);
          const fontSize = 12 + scale * 20; // 12px to 32px
          return { tag, count, fontSize };
        });

      tagCloud.innerHTML = tags.map(({ tag, count, fontSize }) =>
        \`<span class="tag \${currentFilter === tag ? 'active' : ''}"
              style="font-size: \${fontSize}px;"
              onclick="filterByTag('\${tag.replace(/'/g, "\\\\'")}')">
          \${tag} (\${count})
        </span>\`
      ).join('');
    }

    function renderTopicClusters() {
      const container = document.getElementById('topicClusters');

      if (filteredMemories.length === 0) {
        container.innerHTML = '<div class="empty">No memories found</div>';
        return;
      }

      // Count by type
      const typeCounts = new Map();
      for (const memory of filteredMemories) {
        const type = memory.type || 'unknown';
        typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
      }

      const maxCount = Math.max(...typeCounts.values());
      const types = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);

      container.innerHTML = types.map(([type, count]) => {
        const percentage = (count / maxCount) * 100;
        return \`
          <div class="topic-row">
            <div class="topic-label">\${type}</div>
            <div class="topic-bar-container">
              <div class="topic-bar" style="width: \${percentage}%">\${count}</div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function renderTimeline() {
      const timeline = document.getElementById('timeline');

      if (filteredMemories.length === 0) {
        timeline.innerHTML = '<div class="empty">No memories to display</div>';
        return;
      }

      // Sort by createdAt descending
      const sorted = [...filteredMemories].sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt)
      );

      timeline.innerHTML = sorted.map((memory, idx) => \`
        <div class="timeline-item" onclick="toggleTimeline(\${idx})">
          <div class="timeline-dot"></div>
          <div class="timeline-content">
            <div class="timeline-title">\${memory.title || 'Untitled'}</div>
            <div class="timeline-meta">
              <span>\${memory.authorName || memory.authorId}</span>
              <span>\${formatDate(memory.createdAt)}</span>
              <span>\${memory.type}</span>
            </div>
            <div class="timeline-body" id="timeline-body-\${idx}">
              \${memory.content}
            </div>
          </div>
        </div>
      \`).join('');
    }

    function toggleTimeline(idx) {
      const item = document.querySelectorAll('.timeline-item')[idx];
      item.classList.toggle('expanded');
    }

    function renderContributors() {
      const container = document.getElementById('contributors');

      if (filteredMemories.length === 0) {
        container.innerHTML = '<div class="empty">No contributors found</div>';
        return;
      }

      // Count by author
      const authorCounts = new Map();
      for (const memory of filteredMemories) {
        const author = memory.authorName || memory.authorId;
        authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
      }

      const authors = [...authorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10); // Top 10

      container.innerHTML = authors.map(([author, count], idx) => \`
        <div class="contributor-row">
          <div class="contributor-rank">\${idx + 1}</div>
          <div class="contributor-name">\${author}</div>
          <div class="contributor-count">\${count}</div>
        </div>
      \`).join('');
    }

    function renderActivity() {
      const activity = document.getElementById('activity');

      if (filteredMemories.length === 0) {
        activity.innerHTML = '<div class="empty">No recent activity</div>';
        return;
      }

      // Last 20 memories
      const recent = [...filteredMemories]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 20);

      activity.innerHTML = recent.map(memory => \`
        <div class="activity-item">
          <div class="activity-badge">\${memory.authorName || memory.authorId}</div>
          <div class="activity-text">\${memory.title || memory.content.slice(0, 60)}...</div>
          <div class="activity-time">\${formatRelative(memory.createdAt)}</div>
        </div>
      \`).join('');
    }

    function filterByTag(tag) {
      if (currentFilter === tag) {
        // Clear filter
        currentFilter = null;
        filteredMemories = allMemories;
        document.getElementById('filterBadge').style.display = 'none';
      } else {
        // Apply filter
        currentFilter = tag;
        filteredMemories = allMemories.filter(m => (m.tags || []).includes(tag));

        const badge = document.getElementById('filterBadge');
        badge.innerHTML = \`<div class="filter-badge" onclick="filterByTag('\${tag.replace(/'/g, "\\\\'")}')">
          Filtered by: \${tag}
        </div>\`;
        badge.style.display = 'block';
      }

      renderAll();
    }

    function formatDate(isoString) {
      const date = new Date(isoString);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    }

    function formatRelative(isoString) {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 60) return \`\${diffMins}m ago\`;
      if (diffHours < 24) return \`\${diffHours}h ago\`;
      if (diffDays < 7) return \`\${diffDays}d ago\`;
      return formatDate(isoString);
    }

    function showError(message) {
      const container = document.querySelector('.container');
      container.innerHTML = \`<div class="error">Error: \${message}</div>\`;
    }

    // Initialize
    fetchMemories();
  </script>
</body>
</html>
`;
