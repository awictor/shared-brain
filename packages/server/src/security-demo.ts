/**
 * Security Dashboard Demo — inline HTML/CSS/JS dark-themed dashboard
 * showing rate limits, audit log, config status, and input validation tester.
 */

import type { Application } from 'express';
import type { SecurityLayer } from './security.js';

export function registerSecurityDemo(app: Application, security: SecurityLayer): void {
  // ─── API endpoints for the dashboard ──────────────────────────────────

  app.get('/api/audit', (_req, res) => {
    const entries = security.getAuditLog(100);
    res.json(entries);
  });

  app.get('/api/security/status', (_req, res) => {
    res.json(security.getStatus());
  });

  app.get('/api/security/ratelimits', (_req, res) => {
    res.json(security.getRateLimitStatus());
  });

  app.post('/api/security/test-sanitize', (req, res) => {
    const { content, title, tags } = req.body || {};
    // Import sanitization without actually blocking
    const testBody = { content, title, tags };

    // Manually run validation logic
    const errors: string[] = [];
    const sanitized: any = { ...testBody };
    const maxLen = 50000;

    if (sanitized.content) {
      if (typeof sanitized.content !== 'string') {
        errors.push('content must be a string');
      } else {
        if (sanitized.content.length > maxLen) {
          errors.push(`content exceeds maximum length of ${maxLen} characters (got ${sanitized.content.length})`);
        }
        // Strip HTML
        sanitized.content = sanitized.content
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '');
      }
    }

    if (sanitized.title) {
      if (typeof sanitized.title !== 'string') {
        errors.push('title must be a string');
      } else {
        if (sanitized.title.length > 200) {
          errors.push(`title exceeds maximum length of 200 characters (got ${sanitized.title.length})`);
        }
        sanitized.title = sanitized.title.replace(/<[^>]*>/g, '').slice(0, 200);
      }
    }

    if (sanitized.tags) {
      if (!Array.isArray(sanitized.tags)) {
        errors.push('tags must be an array');
      } else {
        if (sanitized.tags.length > 20) {
          errors.push(`too many tags: maximum 20 allowed (got ${sanitized.tags.length})`);
        }
        const longTags = sanitized.tags.filter((t: any) => typeof t === 'string' && t.length > 50);
        if (longTags.length) {
          errors.push(`${longTags.length} tag(s) exceed maximum length of 50 characters`);
        }
        sanitized.tags = sanitized.tags
          .filter((t: any) => typeof t === 'string')
          .slice(0, 20)
          .map((t: string) => t.replace(/<[^>]*>/g, '').slice(0, 50));
      }
    }

    res.json({ valid: errors.length === 0, errors, sanitized });
  });

  // ─── Dashboard HTML ───────────────────────────────────────────────────

  app.get('/demo/security', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(DASHBOARD_HTML);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SharedBrain Security Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #232F3E;
    color: #F5F3EF;
    line-height: 1.6;
    min-height: 100vh;
  }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  h1 {
    color: #FF6100;
    font-size: 28px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  h1 .shield { font-size: 32px; }
  .subtitle { color: #8899AA; margin-bottom: 32px; font-size: 14px; }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
  @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }

  .card {
    background: #1a2332;
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

  .status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .status-item {
    background: #232F3E;
    border-radius: 8px;
    padding: 12px;
    text-align: center;
  }
  .status-item .label { font-size: 11px; color: #8899AA; text-transform: uppercase; letter-spacing: 0.5px; }
  .status-item .value { font-size: 20px; font-weight: 700; color: #F5F3EF; margin-top: 4px; }
  .status-item .value.enabled { color: #4ADE80; }
  .status-item .value.disabled { color: #F87171; }
  .status-item .value.orange { color: #FF6100; }

  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th {
    text-align: left;
    padding: 8px 6px;
    border-bottom: 1px solid #344559;
    color: #8899AA;
    font-weight: 600;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.5px;
  }
  td {
    padding: 6px;
    border-bottom: 1px solid #2a3a4a;
    color: #C8D4E0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  tr:hover td { background: #2a3a4a; }

  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 10px;
    font-weight: 600;
  }
  .badge-get { background: #1a4a2a; color: #4ADE80; }
  .badge-post { background: #4a3a1a; color: #FBBF24; }
  .badge-put { background: #1a3a4a; color: #60A5FA; }
  .badge-delete { background: #4a1a1a; color: #F87171; }
  .badge-ok { background: #1a4a2a; color: #4ADE80; }
  .badge-err { background: #4a1a1a; color: #F87171; }

  .full-width { grid-column: 1 / -1; }

  /* Sanitization test form */
  .test-form { display: flex; flex-direction: column; gap: 12px; }
  .test-form label { font-size: 12px; color: #8899AA; }
  .test-form textarea, .test-form input {
    background: #232F3E;
    border: 1px solid #344559;
    border-radius: 6px;
    padding: 10px;
    color: #F5F3EF;
    font-family: 'Fira Code', 'Cascadia Code', monospace;
    font-size: 12px;
    resize: vertical;
  }
  .test-form textarea:focus, .test-form input:focus {
    outline: none;
    border-color: #FF6100;
  }
  .test-form textarea { min-height: 80px; }
  .btn {
    background: #FF6100;
    color: #fff;
    border: none;
    padding: 10px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    font-size: 13px;
    transition: background 0.2s;
    align-self: flex-start;
  }
  .btn:hover { background: #E55800; }
  .btn:active { transform: scale(0.98); }

  .result-panel {
    background: #232F3E;
    border-radius: 8px;
    padding: 12px;
    margin-top: 12px;
    font-family: monospace;
    font-size: 11px;
    white-space: pre-wrap;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid #344559;
  }
  .result-valid { border-left: 3px solid #4ADE80; }
  .result-invalid { border-left: 3px solid #F87171; }

  .empty-state { color: #5a6a7a; font-style: italic; text-align: center; padding: 20px; }

  .refresh-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    background: none;
    border: 1px solid #344559;
    color: #8899AA;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
  }
  .refresh-btn:hover { border-color: #FF6100; color: #FF6100; }

  .scroll-table { max-height: 400px; overflow-y: auto; }
</style>
</head>
<body>
<div class="container">
  <h1><span class="shield">&#128737;</span> Security Dashboard</h1>
  <p class="subtitle">SharedBrain zero-config security layer &mdash; monitoring and diagnostics</p>

  <div class="grid">
    <!-- Configuration Status -->
    <div class="card">
      <h2>Configuration</h2>
      <button class="refresh-btn" onclick="loadStatus()">Refresh</button>
      <div class="status-grid" id="config-grid">
        <div class="status-item"><div class="label">Auto Token</div><div class="value" id="cfg-token">...</div></div>
        <div class="status-item"><div class="label">Rate Limiting</div><div class="value" id="cfg-ratelimit">...</div></div>
        <div class="status-item"><div class="label">Audit Log</div><div class="value" id="cfg-audit">...</div></div>
        <div class="status-item"><div class="label">Max Content</div><div class="value orange" id="cfg-maxlen">...</div></div>
      </div>
      <div class="status-grid" style="margin-top: 12px;">
        <div class="status-item"><div class="label">Token Status</div><div class="value orange" id="cfg-token-status">...</div></div>
        <div class="status-item"><div class="label">Audit Entries</div><div class="value orange" id="cfg-audit-count">...</div></div>
      </div>
    </div>

    <!-- Rate Limits -->
    <div class="card">
      <h2>Active Rate Limits</h2>
      <button class="refresh-btn" onclick="loadRateLimits()">Refresh</button>
      <div class="scroll-table" id="ratelimit-container">
        <p class="empty-state">No active rate limit windows</p>
      </div>
    </div>

    <!-- Audit Log -->
    <div class="card full-width">
      <h2>Recent Audit Log (last 50)</h2>
      <button class="refresh-btn" onclick="loadAudit()">Refresh</button>
      <div class="scroll-table" id="audit-container">
        <p class="empty-state">Loading audit entries...</p>
      </div>
    </div>

    <!-- Input Validation Tester -->
    <div class="card full-width">
      <h2>Input Validation Tester</h2>
      <div class="test-form">
        <div>
          <label for="test-content">Content (paste text to test sanitization)</label>
          <textarea id="test-content" placeholder="Try: <script>alert('xss')</script> or a very long string..."></textarea>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div>
            <label for="test-title">Title</label>
            <input id="test-title" type="text" placeholder="<b>My Title</b> with HTML" />
          </div>
          <div>
            <label for="test-tags">Tags (comma-separated)</label>
            <input id="test-tags" type="text" placeholder="tag1, <script>bad</script>, tag3" />
          </div>
        </div>
        <button class="btn" onclick="testSanitize()">Test Sanitization</button>
        <div id="sanitize-result"></div>
      </div>
    </div>
  </div>
</div>

<script>
async function loadStatus() {
  try {
    const res = await fetch('/api/security/status');
    const data = await res.json();
    document.getElementById('cfg-token').textContent = data.config.autoToken ? 'ON' : 'OFF';
    document.getElementById('cfg-token').className = 'value ' + (data.config.autoToken ? 'enabled' : 'disabled');
    document.getElementById('cfg-ratelimit').textContent = data.config.rateLimiting ? 'ON' : 'OFF';
    document.getElementById('cfg-ratelimit').className = 'value ' + (data.config.rateLimiting ? 'enabled' : 'disabled');
    document.getElementById('cfg-audit').textContent = data.config.auditLog ? 'ON' : 'OFF';
    document.getElementById('cfg-audit').className = 'value ' + (data.config.auditLog ? 'enabled' : 'disabled');
    document.getElementById('cfg-maxlen').textContent = (data.config.maxContentLength / 1000) + 'KB';
    document.getElementById('cfg-token-status').textContent = data.tokenStatus;
    document.getElementById('cfg-audit-count').textContent = data.auditEntryCount.toLocaleString();
  } catch (e) {
    console.error('Failed to load status:', e);
  }
}

async function loadRateLimits() {
  try {
    const res = await fetch('/api/security/ratelimits');
    const data = await res.json();
    const container = document.getElementById('ratelimit-container');
    if (!data.length) {
      container.innerHTML = '<p class="empty-state">No active rate limit windows</p>';
      return;
    }
    let html = '<table><thead><tr><th>IP</th><th>Endpoint</th><th>Count</th><th>Limit</th><th>Remaining</th></tr></thead><tbody>';
    for (const r of data) {
      html += '<tr><td>' + esc(r.ip) + '</td><td>' + esc(r.endpoint) + '</td><td>' + r.count + '</td><td>' + r.limit + '</td><td>' + r.remaining + '</td></tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    console.error('Failed to load rate limits:', e);
  }
}

async function loadAudit() {
  try {
    const res = await fetch('/api/audit');
    const data = await res.json();
    const container = document.getElementById('audit-container');
    if (!data.length) {
      container.innerHTML = '<p class="empty-state">No audit entries yet</p>';
      return;
    }
    let html = '<table><thead><tr><th>Time</th><th>Method</th><th>Path</th><th>Tool</th><th>Agent</th><th>Status</th><th>Duration</th></tr></thead><tbody>';
    for (const e of data.slice(0, 50)) {
      const time = new Date(e.timestamp).toLocaleTimeString();
      const methodClass = 'badge-' + e.method.toLowerCase();
      const statusClass = e.statusCode < 400 ? 'badge-ok' : 'badge-err';
      html += '<tr>';
      html += '<td>' + time + '</td>';
      html += '<td><span class="badge ' + methodClass + '">' + e.method + '</span></td>';
      html += '<td title="' + esc(e.path) + '">' + esc(e.path) + '</td>';
      html += '<td>' + (e.toolName || '-') + '</td>';
      html += '<td>' + (e.agentId ? esc(e.agentId.slice(0, 8)) : '-') + '</td>';
      html += '<td><span class="badge ' + statusClass + '">' + e.statusCode + '</span></td>';
      html += '<td>' + e.durationMs.toFixed(0) + 'ms</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    console.error('Failed to load audit:', e);
  }
}

async function testSanitize() {
  const content = document.getElementById('test-content').value;
  const title = document.getElementById('test-title').value;
  const tagsRaw = document.getElementById('test-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;

  const body = {};
  if (content) body.content = content;
  if (title) body.title = title;
  if (tags) body.tags = tags;

  try {
    const res = await fetch('/api/security/test-sanitize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    const panel = document.getElementById('sanitize-result');
    const cls = data.valid ? 'result-valid' : 'result-invalid';
    let html = '<div class="result-panel ' + cls + '">';
    html += (data.valid ? 'VALID' : 'INVALID') + '\\n\\n';
    if (data.errors.length) {
      html += 'Errors:\\n';
      for (const e of data.errors) html += '  - ' + esc(e) + '\\n';
      html += '\\n';
    }
    html += 'Sanitized output:\\n' + esc(JSON.stringify(data.sanitized, null, 2));
    html += '</div>';
    panel.innerHTML = html;
  } catch (e) {
    document.getElementById('sanitize-result').innerHTML = '<div class="result-panel result-invalid">Error: ' + e.message + '</div>';
  }
}

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Load on startup
loadStatus();
loadRateLimits();
loadAudit();

// Auto-refresh every 10s
setInterval(() => { loadStatus(); loadRateLimits(); loadAudit(); }, 10000);
</script>
</body>
</html>`;
