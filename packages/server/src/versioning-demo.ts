/**
 * versioning-demo.ts — Memory version history UI
 *
 * GET /demo/versions — search for a memory and view its full history with diff
 */

import type { Application } from 'express';
import type { VersionManager } from './versioning.js';

export function registerVersioningDemo(app: Application, versionManager: VersionManager, store: any): void {
  app.get('/demo/versions', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Memory Versions — SharedBrain</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%);
      color: #e0e0e0;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { color: #888; margin-bottom: 2rem; }
    .search-box {
      background: rgba(255,255,255,0.05);
      padding: 1.5rem;
      border-radius: 12px;
      margin-bottom: 2rem;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .search-box input {
      width: 100%;
      padding: 0.75rem;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      color: #fff;
      font-size: 1rem;
      margin-bottom: 1rem;
    }
    .search-box input:focus {
      outline: none;
      border-color: #667eea;
    }
    .btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #fff;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1rem;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .timeline {
      position: relative;
      padding-left: 2rem;
    }
    .timeline::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 2px;
      background: linear-gradient(180deg, #667eea 0%, #764ba2 100%);
    }
    .version-entry {
      background: rgba(255,255,255,0.05);
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
      border: 1px solid rgba(255,255,255,0.1);
      position: relative;
    }
    .version-entry::before {
      content: '';
      position: absolute;
      left: -2.5rem;
      top: 1rem;
      width: 12px;
      height: 12px;
      background: #667eea;
      border-radius: 50%;
      border: 2px solid #1a1a2e;
    }
    .version-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .version-number {
      font-weight: 700;
      color: #667eea;
      font-size: 1.1rem;
    }
    .change-type {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .change-type.created { background: #22c55e; color: #000; }
    .change-type.updated { background: #3b82f6; color: #fff; }
    .change-type.deleted { background: #ef4444; color: #fff; }
    .version-meta {
      color: #888;
      font-size: 0.875rem;
      margin-bottom: 0.75rem;
    }
    .content-snippet {
      background: rgba(0,0,0,0.3);
      padding: 0.75rem;
      border-radius: 4px;
      border-left: 3px solid #667eea;
      margin-bottom: 0.5rem;
      font-family: "SF Mono", Monaco, monospace;
      font-size: 0.875rem;
      line-height: 1.6;
    }
    .version-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }
    .btn-sm {
      padding: 0.4rem 0.75rem;
      font-size: 0.875rem;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
    }
    .btn-sm:hover { background: rgba(255,255,255,0.15); }
    .diff-view {
      background: rgba(0,0,0,0.5);
      padding: 1rem;
      border-radius: 8px;
      margin-top: 1rem;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .diff-header {
      font-weight: 700;
      margin-bottom: 0.75rem;
      color: #667eea;
    }
    .diff-field {
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .diff-field:last-child { border-bottom: none; }
    .diff-field-name {
      font-weight: 600;
      color: #888;
      font-size: 0.875rem;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
    }
    .diff-from, .diff-to {
      padding: 0.5rem;
      border-radius: 4px;
      margin-bottom: 0.25rem;
      font-family: "SF Mono", Monaco, monospace;
      font-size: 0.875rem;
    }
    .diff-from {
      background: rgba(239, 68, 68, 0.2);
      border-left: 3px solid #ef4444;
    }
    .diff-to {
      background: rgba(34, 197, 94, 0.2);
      border-left: 3px solid #22c55e;
    }
    .empty-state {
      text-align: center;
      padding: 3rem;
      color: #666;
    }
    .error {
      background: rgba(239, 68, 68, 0.2);
      border: 1px solid #ef4444;
      color: #ef4444;
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 1rem;
    }
    .memory-info {
      background: rgba(102, 126, 234, 0.1);
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 2rem;
      border: 1px solid rgba(102, 126, 234, 0.3);
    }
    .memory-info h3 {
      color: #667eea;
      margin-bottom: 0.5rem;
    }
    .memory-content {
      background: rgba(0,0,0,0.3);
      padding: 0.75rem;
      border-radius: 4px;
      margin-top: 0.5rem;
      font-family: "SF Mono", Monaco, monospace;
      font-size: 0.875rem;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Memory Versions</h1>
    <p class="subtitle">Track every change to your memories — view history, compare versions, and revert if needed.</p>

    <div class="search-box">
      <input type="text" id="memoryId" placeholder="Enter Memory ID (UUID)" />
      <button class="btn" onclick="loadHistory()">Load History</button>
    </div>

    <div id="error"></div>
    <div id="memoryInfo"></div>
    <div id="timeline"></div>
  </div>

  <script>
    let currentHistory = [];
    let currentMemory = null;

    async function loadHistory() {
      const memoryId = document.getElementById('memoryId').value.trim();
      if (!memoryId) {
        showError('Please enter a memory ID');
        return;
      }

      clearError();
      document.getElementById('memoryInfo').innerHTML = '';
      document.getElementById('timeline').innerHTML = '<p class="empty-state">Loading...</p>';

      try {
        // Fetch memory info
        const memoryRes = await fetch('/api/versions/memory/' + encodeURIComponent(memoryId));
        if (!memoryRes.ok) throw new Error('Memory not found');
        currentMemory = await memoryRes.json();

        // Fetch version history
        const historyRes = await fetch('/api/versions/history/' + encodeURIComponent(memoryId));
        if (!historyRes.ok) throw new Error('Failed to load history');
        const data = await historyRes.json();

        if (!data.history || data.history.length === 0) {
          document.getElementById('timeline').innerHTML = '<p class="empty-state">No version history available for this memory.</p>';
          return;
        }

        currentHistory = data.history;
        renderMemoryInfo();
        renderTimeline();
      } catch (err) {
        showError(err.message || 'Failed to load history');
        document.getElementById('timeline').innerHTML = '';
      }
    }

    function renderMemoryInfo() {
      if (!currentMemory) return;
      document.getElementById('memoryInfo').innerHTML = \`
        <div class="memory-info">
          <h3>\${currentMemory.title || 'Untitled Memory'}</h3>
          <div style="color: #888; font-size: 0.875rem; margin-bottom: 0.5rem;">
            <strong>Type:</strong> \${currentMemory.type} |
            <strong>Author:</strong> \${currentMemory.authorName} |
            <strong>Current Version:</strong> \${currentMemory.version}
          </div>
          <div class="memory-content">\${currentMemory.content}</div>
        </div>
      \`;
    }

    function renderTimeline() {
      const html = currentHistory.map((v, idx) => \`
        <div class="version-entry">
          <div class="version-header">
            <span class="version-number">Version \${v.version}</span>
            <span class="change-type \${v.changeType}">\${v.changeType}</span>
          </div>
          <div class="version-meta">
            <strong>\${v.changedBy}</strong> • \${new Date(v.changedAt).toLocaleString()}
          </div>
          \${v.title ? \`<div style="font-weight: 600; margin-bottom: 0.5rem;">\${v.title}</div>\` : ''}
          <div class="content-snippet">\${v.contentSnippet}</div>
          <div style="color: #888; font-size: 0.75rem;">
            <strong>Tags:</strong> \${v.tags.length > 0 ? v.tags.join(', ') : 'None'}
          </div>
          <div class="version-actions">
            \${idx < currentHistory.length - 1 ? \`<button class="btn btn-sm" onclick="showDiff(\${v.version}, \${currentHistory[idx+1].version})">Compare with v\${currentHistory[idx+1].version}</button>\` : ''}
            <button class="btn btn-sm" onclick="viewFull(\${v.version})">View Full</button>
          </div>
          <div id="diff-\${v.version}"></div>
        </div>
      \`).join('');
      document.getElementById('timeline').innerHTML = '<div class="timeline">' + html + '</div>';
    }

    async function showDiff(v1, v2) {
      const memoryId = document.getElementById('memoryId').value.trim();
      const container = document.getElementById('diff-' + v1);
      container.innerHTML = '<p style="color: #888; font-size: 0.875rem;">Loading diff...</p>';

      try {
        const res = await fetch('/api/versions/diff/' + encodeURIComponent(memoryId) + '?v1=' + v2 + '&v2=' + v1);
        if (!res.ok) throw new Error('Failed to load diff');
        const data = await res.json();

        if (data.changes.length === 0) {
          container.innerHTML = '<div class="diff-view"><p style="color: #888;">No changes detected.</p></div>';
          return;
        }

        const diffHtml = data.changes.map(change => \`
          <div class="diff-field">
            <div class="diff-field-name">\${change.field}</div>
            <div class="diff-from"><strong>- v\${v2}:</strong> \${change.from.slice(0, 200)}\${change.from.length > 200 ? '...' : ''}</div>
            <div class="diff-to"><strong>+ v\${v1}:</strong> \${change.to.slice(0, 200)}\${change.to.length > 200 ? '...' : ''}</div>
          </div>
        \`).join('');

        container.innerHTML = \`
          <div class="diff-view">
            <div class="diff-header">Changes from v\${v2} → v\${v1}</div>
            \${diffHtml}
          </div>
        \`;
      } catch (err) {
        container.innerHTML = '<div class="error">Failed to load diff: ' + err.message + '</div>';
      }
    }

    async function viewFull(version) {
      const memoryId = document.getElementById('memoryId').value.trim();
      try {
        const res = await fetch('/api/versions/version/' + encodeURIComponent(memoryId) + '/' + version);
        if (!res.ok) throw new Error('Failed to load version');
        const data = await res.json();
        alert('Version ' + version + ':\\n\\n' + data.content);
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    function showError(msg) {
      document.getElementById('error').innerHTML = '<div class="error">' + msg + '</div>';
    }

    function clearError() {
      document.getElementById('error').innerHTML = '';
    }
  </script>
</body>
</html>
`);
  });

  // API endpoints for version data
  app.get('/api/versions/memory/:id', async (req, res) => {
    try {
      const memory = await store.getMemory(req.params.id);
      if (!memory || memory.deleted) {
        res.status(404).json({ error: 'Memory not found' });
        return;
      }
      const { embedding, ...memoryWithoutEmbedding } = memory;
      res.json(memoryWithoutEmbedding);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch memory' });
    }
  });

  app.get('/api/versions/history/:id', (req, res) => {
    try {
      const history = versionManager.getHistory(req.params.id, 100);
      res.json({ history, count: history.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch history' });
    }
  });

  app.get('/api/versions/diff/:id', (req, res) => {
    try {
      const v1 = parseInt(req.query.v1 as string, 10);
      const v2 = parseInt(req.query.v2 as string, 10);
      const changes = versionManager.diff(req.params.id, v1, v2);
      res.json({ changes });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to compute diff' });
    }
  });

  app.get('/api/versions/version/:id/:version', (req, res) => {
    try {
      const version = parseInt(req.params.version, 10);
      const data = versionManager.getVersion(req.params.id, version);
      if (!data) {
        res.status(404).json({ error: 'Version not found' });
        return;
      }
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch version' });
    }
  });
}
