/**
 * Ingest Demo — interactive test page for the ingestion webhooks.
 */

import type { Application } from 'express';
import type { IngestEngine } from './ingest.js';

export function registerIngestDemo(app: Application, ingestEngine: IngestEngine): void {
  app.get('/demo/ingest', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(DEMO_HTML);
  });
}

const DEMO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SharedBrain Ingest Demo</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #232F3E;
  color: #F5F3EF;
  min-height: 100vh;
  padding: 2rem;
}
h1 {
  color: #FF6100;
  font-size: 1.8rem;
  margin-bottom: 0.5rem;
}
.subtitle { color: #9CA3AF; margin-bottom: 2rem; font-size: 0.9rem; }
.tabs {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #374151;
  margin-bottom: 1.5rem;
}
.tab {
  padding: 0.75rem 1.5rem;
  cursor: pointer;
  color: #9CA3AF;
  border: none;
  background: none;
  font-size: 0.95rem;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}
.tab:hover { color: #F5F3EF; }
.tab.active { color: #FF6100; border-bottom-color: #FF6100; }
.panel { display: none; }
.panel.active { display: block; }
.editor-area {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  margin-bottom: 1.5rem;
}
@media (max-width: 900px) { .editor-area { grid-template-columns: 1fr; } }
textarea {
  width: 100%;
  min-height: 320px;
  background: #1A2332;
  color: #F5F3EF;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 1rem;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  resize: vertical;
}
textarea:focus { outline: none; border-color: #FF6100; }
.result-box {
  background: #1A2332;
  border: 1px solid #374151;
  border-radius: 8px;
  padding: 1rem;
  min-height: 320px;
  overflow: auto;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
  white-space: pre-wrap;
  word-break: break-word;
}
.result-box .success { color: #10B981; }
.result-box .skipped { color: #F59E0B; }
.result-box .error { color: #EF4444; }
.controls {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-bottom: 2rem;
}
.btn {
  padding: 0.6rem 1.5rem;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-primary { background: #FF6100; color: #FFF; }
.btn-primary:hover { background: #E05500; }
.btn-primary:disabled { background: #555; cursor: not-allowed; }
.btn-secondary { background: #374151; color: #F5F3EF; }
.btn-secondary:hover { background: #4B5563; }
.token-input {
  background: #1A2332;
  border: 1px solid #374151;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #F5F3EF;
  font-size: 0.85rem;
  width: 220px;
}
.token-input:focus { outline: none; border-color: #FF6100; }
label { font-size: 0.8rem; color: #9CA3AF; margin-bottom: 0.25rem; display: block; }
h2 { color: #FF6100; font-size: 1.2rem; margin: 2rem 0 1rem; }
.log-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.log-table th {
  text-align: left;
  padding: 0.5rem;
  color: #9CA3AF;
  border-bottom: 1px solid #374151;
  font-weight: 500;
}
.log-table td {
  padding: 0.5rem;
  border-bottom: 1px solid #1A2332;
  vertical-align: top;
}
.log-table tr:hover { background: #1A2332; }
.badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
}
.badge-stored { background: #065F46; color: #10B981; }
.badge-skipped { background: #78350F; color: #F59E0B; }
.mono { font-family: monospace; font-size: 0.75rem; color: #9CA3AF; }
</style>
</head>
<body>

<h1>SharedBrain Ingest Demo</h1>
<p class="subtitle">Test passive ingestion webhooks — Slack, Email, Meeting, Generic</p>

<div class="controls">
  <div>
    <label for="token">Ingest Token</label>
    <input type="password" id="token" class="token-input" placeholder="your INGEST_TOKEN" />
  </div>
  <button class="btn btn-primary" id="sendBtn" onclick="send()">Send</button>
  <button class="btn btn-secondary" onclick="refreshLog()">Refresh Log</button>
</div>

<div class="tabs">
  <button class="tab active" data-tab="slack">Slack</button>
  <button class="tab" data-tab="email">Email</button>
  <button class="tab" data-tab="meeting">Meeting</button>
  <button class="tab" data-tab="generic">Generic</button>
</div>

<div id="panel-slack" class="panel active">
  <div class="editor-area">
    <div>
      <label>Payload (JSON)</label>
      <textarea id="input-slack"></textarea>
    </div>
    <div>
      <label>Result</label>
      <div class="result-box" id="result-slack">Click "Send" to test...</div>
    </div>
  </div>
</div>

<div id="panel-email" class="panel">
  <div class="editor-area">
    <div>
      <label>Payload (JSON)</label>
      <textarea id="input-email"></textarea>
    </div>
    <div>
      <label>Result</label>
      <div class="result-box" id="result-email">Click "Send" to test...</div>
    </div>
  </div>
</div>

<div id="panel-meeting" class="panel">
  <div class="editor-area">
    <div>
      <label>Payload (JSON)</label>
      <textarea id="input-meeting"></textarea>
    </div>
    <div>
      <label>Result</label>
      <div class="result-box" id="result-meeting">Click "Send" to test...</div>
    </div>
  </div>
</div>

<div id="panel-generic" class="panel">
  <div class="editor-area">
    <div>
      <label>Payload (JSON)</label>
      <textarea id="input-generic"></textarea>
    </div>
    <div>
      <label>Result</label>
      <div class="result-box" id="result-generic">Click "Send" to test...</div>
    </div>
  </div>
</div>

<h2>Ingest Log</h2>
<table class="log-table" id="logTable">
  <thead>
    <tr><th>Time</th><th>Source</th><th>Detail</th><th>Status</th><th>Memory ID</th><th>Reason</th></tr>
  </thead>
  <tbody id="logBody">
    <tr><td colspan="6" style="color:#9CA3AF">Loading...</td></tr>
  </tbody>
</table>

<script>
const EXAMPLES = {
  slack: {
    channel: "sps-general",
    channel_name: "sps-general",
    user: "U1234ABC",
    user_name: "jdoe",
    text: "We decided to move the launch date to next Friday. @awictor will own the go-to-market deck. Action item: finalize pricing by Wednesday.",
    ts: "1719100000.000100",
    thread_ts: null
  },
  email: {
    from: "manager@amazon.com",
    to: "awictor@amazon.com",
    subject: "Re: Q3 Brand Strategy alignment",
    body: "Team,\\n\\nWe agreed on the following next steps:\\n1. TODO: awictor to prepare the CRB tracker for the 5 priority brands by Friday\\n2. Deadline for the QBR deck draft is July 1\\n3. Action item: schedule a follow-up with the analytics team to validate GMS projections\\n\\nLet me know if any blockers come up.",
    date: "2026-06-23T09:30:00Z",
    thread_id: "thread-abc-123"
  },
  meeting: {
    title: "Weekly SPS Sync",
    attendees: ["awictor", "jdoe", "msmith"],
    date: "2026-06-23",
    notes: "Discussed Q3 pipeline health. 4 brands in active onboarding. GMS target tracking at 85% of plan. Need to accelerate follow-ups on stale accounts. Decided to implement weekly digest alerts for the team.",
    action_items: [
      "awictor: Build weekly digest skill for automated Monday reports",
      "jdoe: Follow up with Brand XYZ on FBA enrollment — blocked on compliance docs",
      "msmith: Schedule QBR prep sessions for top 3 accounts"
    ],
    duration_minutes: 30
  },
  generic: {
    content: "Learned that the new Andes table seller_gms_daily_v3 includes NTB (new-to-brand) breakdowns at the ASIN level. This supersedes the old seller_gms_daily table which only had merchant-level aggregates. Access via DataNet job profile DP-12345.",
    source: "research-note",
    title: "Andes: seller_gms_daily_v3 has NTB breakdowns",
    tags: ["andes", "data-discovery", "ntb"]
  }
};

// Populate textareas
for (const [type, data] of Object.entries(EXAMPLES)) {
  document.getElementById('input-' + type).value = JSON.stringify(data, null, 2);
}

// Tab switching
let activeTab = 'slack';
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    activeTab = tab.dataset.tab;
    document.getElementById('panel-' + activeTab).classList.add('active');
  });
});

async function send() {
  const token = document.getElementById('token').value;
  if (!token) { alert('Enter your INGEST_TOKEN first'); return; }

  const input = document.getElementById('input-' + activeTab);
  const resultBox = document.getElementById('result-' + activeTab);
  const btn = document.getElementById('sendBtn');

  let payload;
  try {
    payload = JSON.parse(input.value);
  } catch (e) {
    resultBox.innerHTML = '<span class="error">Invalid JSON: ' + e.message + '</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';
  resultBox.textContent = 'Sending...';

  try {
    const resp = await fetch('/ingest/' + activeTab, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ingest-Token': token },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();

    if (resp.ok) {
      if (data.stored) {
        resultBox.innerHTML = '<span class="success">STORED</span>\\n\\n' + JSON.stringify(data, null, 2);
      } else {
        resultBox.innerHTML = '<span class="skipped">SKIPPED</span>\\n\\n' + JSON.stringify(data, null, 2);
      }
    } else {
      resultBox.innerHTML = '<span class="error">ERROR ' + resp.status + '</span>\\n\\n' + JSON.stringify(data, null, 2);
    }
  } catch (e) {
    resultBox.innerHTML = '<span class="error">Network error: ' + e.message + '</span>';
  }

  btn.disabled = false;
  btn.textContent = 'Send';
  refreshLog();
}

async function refreshLog() {
  try {
    const resp = await fetch('/ingest/log?limit=25');
    const data = await resp.json();
    const tbody = document.getElementById('logBody');

    if (!data.entries || data.entries.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#9CA3AF">No ingestion activity yet</td></tr>';
      return;
    }

    tbody.innerHTML = data.entries.map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString();
      const badge = e.stored
        ? '<span class="badge badge-stored">stored</span>'
        : '<span class="badge badge-skipped">skipped</span>';
      const ids = e.memoryId || (e.memoryIds || []).join(', ') || '-';
      return '<tr>' +
        '<td class="mono">' + time + '</td>' +
        '<td>' + e.source + '</td>' +
        '<td>' + (e.sourceDetail || '-').substring(0, 40) + '</td>' +
        '<td>' + badge + '</td>' +
        '<td class="mono">' + ids.substring(0, 12) + '</td>' +
        '<td style="color:#9CA3AF">' + (e.reason || '-') + '</td>' +
        '</tr>';
    }).join('');
  } catch (e) {
    console.error('Failed to load log:', e);
  }
}

// Load log on page open
refreshLog();
</script>
</body>
</html>`;
