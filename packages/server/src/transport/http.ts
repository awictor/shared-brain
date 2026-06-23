/**
 * Streamable HTTP transport — single /mcp endpoint for all MCP communication.
 * Stateless mode: creates a fresh McpServer + transport per request.
 */

import type { Application, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { MemoryHandler } from '../mcp/handler.js';
import type { Store } from '../mcp/handler.js';

interface TransportDeps {
  handler: MemoryHandler;
  store: Store;
  registerTools: (server: McpServer, deps: { handler: MemoryHandler }) => void;
  registerResources: (server: McpServer, deps: { store: Store }) => void;
}

export function createHttpTransport(deps: TransportDeps, app: Application): void {
  const createMcpServer = () => {
    const server = new McpServer({
      name: 'shared-brain',
      version: '0.1.0',
    });
    deps.registerTools(server, { handler: deps.handler });
    deps.registerResources(server, { store: deps.store });
    return server;
  };

  app.post('/mcp', async (req: Request, res: Response) => {
    const server = createMcpServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Internal error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (_req: Request, res: Response) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }));
  });

  app.delete('/mcp', async (_req: Request, res: Response) => {
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }));
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'shared-brain',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ui', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(DASHBOARD_HTML);
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain Dashboard</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#232F3E;--surface:#2a3a4a;--border:#3a4a5a;--text:#F5F3EF;--muted:#a0aab4;--accent:#FF6100;--accent-dim:#cc4e00;--success:#10b981;--card:#1e2d3d;--hover:#2f4050}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.5}
a{color:var(--accent);text-decoration:none}
input,select,textarea,button{font:inherit;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:8px 12px;outline:none;transition:border-color .2s}
input:focus,select:focus,textarea:focus{border-color:var(--accent)}
button{cursor:pointer;background:var(--accent);border:none;color:#fff;font-weight:600;padding:10px 20px;transition:background .2s}
button:hover{background:var(--accent-dim)}
.layout{display:grid;grid-template-columns:240px 1fr;grid-template-rows:auto auto 1fr;min-height:100vh;gap:0}
.stats-bar{grid-column:1/-1;display:flex;gap:24px;padding:12px 24px;background:var(--surface);border-bottom:1px solid var(--border);align-items:center}
.stat{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.stat b{color:var(--text);font-size:15px}
.header{grid-column:1/-1;padding:20px 24px 16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.header h1{font-size:22px;font-weight:700;color:var(--text)}
.header h1 span{color:var(--accent)}
.search-box{flex:1;min-width:280px;position:relative}
.search-box input{width:100%;padding:10px 16px 10px 40px;font-size:15px;border-radius:8px}
.search-box::before{content:'\\1F50D';position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:14px;opacity:.6}
.sidebar{padding:20px;border-right:1px solid var(--border);overflow-y:auto}
.sidebar h3{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px;margin-top:16px}
.sidebar h3:first-child{margin-top:0}
.filter-group label{display:flex;align-items:center;gap:6px;font-size:13px;padding:4px 0;cursor:pointer}
.filter-group input[type=checkbox]{accent-color:var(--accent)}
.filter-group input[type=date]{width:100%;font-size:12px;padding:6px 8px;margin-top:4px}
.main{padding:20px 24px;overflow-y:auto}
.cards{display:grid;gap:12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;transition:border-color .2s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-1px)}
.card-header{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.card-title{font-weight:600;font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:11px;padding:2px 8px;border-radius:12px;font-weight:500;text-transform:uppercase;letter-spacing:.3px}
.badge-type{background:#1e3a5f;color:#60a5fa}
.badge-scope{background:#1e3f2e;color:#6ee7b7}
.card-content{font-size:13px;color:var(--muted);margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-footer{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tag{font-size:11px;padding:2px 6px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--muted)}
.card-date{font-size:11px;color:var(--muted);margin-left:auto}
.score-bar{height:4px;border-radius:2px;background:var(--border);width:60px;overflow:hidden;margin-left:8px}
.score-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--success))}
.score-label{font-size:11px;color:var(--muted)}
.form-section{grid-column:1/-1;padding:16px 24px;border-top:1px solid var(--border);background:var(--surface)}
.form-toggle{cursor:pointer;font-size:13px;color:var(--accent);font-weight:600;display:flex;align-items:center;gap:6px}
.form-body{display:none;margin-top:12px}
.form-body.open{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.form-body .full{grid-column:1/-1}
.form-body textarea{min-height:80px;resize:vertical}
.radio-group{display:flex;gap:16px;align-items:center}
.radio-group label{font-size:13px;display:flex;align-items:center;gap:4px;cursor:pointer}
.radio-group input{accent-color:var(--accent)}
.empty{text-align:center;padding:60px 20px;color:var(--muted)}
.empty p{margin-top:8px;font-size:14px}
.loading{text-align:center;padding:40px;color:var(--muted)}
@media(max-width:768px){.layout{grid-template-columns:1fr}.sidebar{display:none}.form-body.open{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="layout">
  <div class="stats-bar">
    <div class="stat">Memories: <b id="stat-total">—</b></div>
    <div class="stat">Tags: <b id="stat-tags">—</b></div>
    <div class="stat">Pending sync: <b id="stat-sync">—</b></div>
  </div>
  <div class="header">
    <h1>Shared<span>Brain</span></h1>
    <div class="search-box">
      <input type="text" id="search-input" placeholder="Semantic search memories..." autocomplete="off"/>
    </div>
  </div>
  <aside class="sidebar">
    <h3>Type</h3>
    <div class="filter-group" id="type-filters"></div>
    <h3>Tags</h3>
    <div class="filter-group" id="tag-filters"></div>
    <h3>Date Range</h3>
    <div class="filter-group">
      <input type="date" id="filter-from" placeholder="From"/>
      <input type="date" id="filter-to" placeholder="To" style="margin-top:6px"/>
    </div>
  </aside>
  <main class="main">
    <div id="memory-list" class="cards"><div class="loading">Loading memories...</div></div>
  </main>
</div>
<div class="form-section">
  <div class="form-toggle" onclick="toggleForm()">+ Store New Memory</div>
  <div class="form-body" id="store-form">
    <div class="full"><input type="text" id="f-title" placeholder="Title"/></div>
    <div class="full"><textarea id="f-content" placeholder="Memory content..."></textarea></div>
    <div>
      <select id="f-type"><option value="note">note</option><option value="fact">fact</option><option value="preference">preference</option><option value="procedure">procedure</option><option value="reference">reference</option><option value="context">context</option></select>
    </div>
    <div><input type="text" id="f-tags" placeholder="Tags (comma separated)"/></div>
    <div class="full">
      <div class="radio-group">
        <span style="color:var(--muted);font-size:13px">Scope:</span>
        <label><input type="radio" name="scope" value="global" checked/>Global</label>
        <label><input type="radio" name="scope" value="project"/>Project</label>
        <label><input type="radio" name="scope" value="session"/>Session</label>
      </div>
    </div>
    <div class="full"><button onclick="storeMemory()">Store Memory</button></div>
  </div>
</div>
<script>
const MCP_URL = '/mcp';
let allMemories = [];
let allTags = new Set();
let allTypes = new Set();
let searchTimeout = null;

async function mcpCall(method, params = {}) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: method, arguments: params } });
  const res = await fetch(MCP_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, body });
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await res.text();
    const lines = text.split('\\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { return JSON.parse(line.slice(6)); } catch {}
      }
    }
    return null;
  }
  return res.json();
}

function extractResult(response) {
  if (!response) return null;
  if (response.result && response.result.content) {
    for (const c of response.result.content) {
      if (c.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
    }
  }
  return response.result || response;
}

async function loadMemories() {
  const res = await mcpCall('memory_list', {});
  const data = extractResult(res);
  allMemories = Array.isArray(data) ? data : (data?.memories || []);
  allMemories.sort((a,b) => new Date(b.createdAt || b.created_at || 0) - new Date(a.createdAt || a.created_at || 0));
  collectFilters();
  renderFilters();
  renderMemories(allMemories);
}

async function loadSyncStatus() {
  try {
    const res = await mcpCall('sync_status', {});
    const data = extractResult(res);
    document.getElementById('stat-sync').textContent = data?.pending ?? data?.pendingOps ?? '0';
  } catch { document.getElementById('stat-sync').textContent = '0'; }
}

function collectFilters() {
  allTags = new Set();
  allTypes = new Set();
  for (const m of allMemories) {
    if (m.type) allTypes.add(m.type);
    const tags = m.tags || m.metadata?.tags || [];
    for (const t of tags) allTags.add(t);
  }
  document.getElementById('stat-total').textContent = allMemories.length;
  document.getElementById('stat-tags').textContent = allTags.size;
}

function renderFilters() {
  const typeEl = document.getElementById('type-filters');
  typeEl.innerHTML = [...allTypes].map(t => '<label><input type="checkbox" class="tf" value="'+t+'" checked/>'+t+'</label>').join('');
  const tagEl = document.getElementById('tag-filters');
  const tagArr = [...allTags].slice(0, 20);
  tagEl.innerHTML = tagArr.map(t => '<label><input type="checkbox" class="tgf" value="'+t+'" checked/>'+t+'</label>').join('');
  typeEl.querySelectorAll('.tf').forEach(cb => cb.addEventListener('change', applyFilters));
  tagEl.querySelectorAll('.tgf').forEach(cb => cb.addEventListener('change', applyFilters));
  document.getElementById('filter-from').addEventListener('change', applyFilters);
  document.getElementById('filter-to').addEventListener('change', applyFilters);
}

function applyFilters() {
  const types = [...document.querySelectorAll('.tf:checked')].map(c => c.value);
  const tags = [...document.querySelectorAll('.tgf:checked')].map(c => c.value);
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  let filtered = allMemories.filter(m => {
    if (types.length && m.type && !types.includes(m.type)) return false;
    if (from) { const d = m.createdAt || m.created_at; if (d && d < from) return false; }
    if (to) { const d = m.createdAt || m.created_at; if (d && d > to + 'T23:59:59') return false; }
    return true;
  });
  renderMemories(filtered);
}

function renderMemories(memories, isSearch = false) {
  const el = document.getElementById('memory-list');
  if (!memories.length) { el.innerHTML = '<div class="empty"><p>No memories found</p></div>'; return; }
  el.innerHTML = memories.map(m => {
    const title = m.title || m.content?.slice(0, 50) || 'Untitled';
    const content = m.content || '';
    const type = m.type || 'note';
    const scope = m.scope || m.metadata?.scope || 'global';
    const tags = m.tags || m.metadata?.tags || [];
    const date = m.createdAt || m.created_at || '';
    const score = m.score ?? m.similarity ?? null;
    let scoreHtml = '';
    if (isSearch && score !== null) {
      const pct = Math.round(score * 100);
      scoreHtml = '<span class="score-label">'+pct+'%</span><div class="score-bar"><div class="score-fill" style="width:'+pct+'%"></div></div>';
    }
    const dateStr = date ? new Date(date).toLocaleDateString() : '';
    return '<div class="card"><div class="card-header"><div class="card-title">'+esc(title)+'</div><span class="badge badge-type">'+esc(type)+'</span><span class="badge badge-scope">'+esc(scope)+'</span>'+scoreHtml+'</div><div class="card-content">'+esc(content.slice(0,200))+'</div><div class="card-footer">'+tags.map(t => '<span class="tag">'+esc(t)+'</span>').join('')+'<span class="card-date">'+dateStr+'</span></div></div>';
  }).join('');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

async function searchMemories(query) {
  if (!query.trim()) { renderMemories(allMemories); return; }
  document.getElementById('memory-list').innerHTML = '<div class="loading">Searching...</div>';
  const res = await mcpCall('memory_search', { query });
  const data = extractResult(res);
  const results = Array.isArray(data) ? data : (data?.results || data?.memories || []);
  renderMemories(results, true);
}

function toggleForm() {
  document.getElementById('store-form').classList.toggle('open');
}

async function storeMemory() {
  const content = document.getElementById('f-content').value.trim();
  if (!content) return;
  const title = document.getElementById('f-title').value.trim();
  const type = document.getElementById('f-type').value;
  const tagsRaw = document.getElementById('f-tags').value;
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const scope = document.querySelector('input[name=scope]:checked').value;
  const params = { content };
  if (title) params.title = title;
  if (type) params.type = type;
  if (tags.length) params.tags = tags;
  if (scope) params.scope = scope;
  await mcpCall('memory_store', params);
  document.getElementById('f-content').value = '';
  document.getElementById('f-title').value = '';
  document.getElementById('f-tags').value = '';
  await loadMemories();
}

document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => searchMemories(e.target.value), 400);
});

loadMemories();
loadSyncStatus();
</script>
</body>
</html>`;

