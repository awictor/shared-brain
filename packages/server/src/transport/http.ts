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
  registerTools: (server: McpServer, deps: any) => void;
  registerResources: (server: McpServer, deps: { store: Store }) => void;
  toolDeps?: Record<string, unknown>;
}

function getNavBar(activePage: string = ''): string {
  const links = [
    { href: '/', label: 'Home', id: 'home' },
    { href: '/ui', label: 'Dashboard', id: 'ui' },
    { href: '/status', label: 'Status', id: 'status' },
    { href: '/setup', label: 'Setup', id: 'setup' },
    { href: '/demo/organizer', label: 'Organizer', id: 'organizer' },
    { href: '/demo/ingest', label: 'Ingest', id: 'ingest' },
    { href: '/demo/sync', label: 'Sync', id: 'sync' },
    { href: '/demo/identity', label: 'Identity', id: 'identity' },
    { href: '/demo/security', label: 'Security', id: 'security' },
    { href: '/demo/checkin', label: 'Checkin', id: 'checkin' },
  ];
  const navItems = links.map(l => {
    const isActive = l.id === activePage;
    return `<a href="${l.href}" class="nav-link${isActive ? ' nav-active' : ''}">${l.label}</a>`;
  }).join('');

  return `<nav class="shared-nav">
  <div class="nav-brand"><a href="/">Shared<span>Brain</span></a></div>
  <button class="nav-hamburger" onclick="document.querySelector('.nav-links').classList.toggle('nav-open')" aria-label="Menu">&#9776;</button>
  <div class="nav-links">${navItems}</div>
</nav>
<style>
.shared-nav{display:flex;align-items:center;gap:16px;padding:10px 24px;background:#1a2530;border-bottom:2px solid #2a3a4a;position:sticky;top:0;z-index:1000}
.nav-brand a{font-size:18px;font-weight:700;color:#F5F3EF;text-decoration:none}
.nav-brand a span{color:#FF6100}
.nav-links{display:flex;gap:4px;margin-left:auto;flex-wrap:wrap}
.nav-link{font-size:13px;padding:6px 12px;color:#a0aab4;text-decoration:none;border-radius:4px;border-bottom:2px solid transparent;transition:color .2s,border-color .2s}
.nav-link:hover{color:#F5F3EF;background:#2a3a4a}
.nav-active{color:#FF6100!important;border-bottom-color:#FF6100}
.nav-hamburger{display:none;background:none;border:none;color:#F5F3EF;font-size:22px;cursor:pointer;margin-left:auto;padding:4px 8px}
@media(max-width:768px){.nav-hamburger{display:block}.nav-links{display:none;flex-direction:column;position:absolute;top:100%;left:0;right:0;background:#1a2530;padding:8px 16px;border-bottom:2px solid #2a3a4a}.nav-links.nav-open{display:flex}}
</style>`;
}

export function createHttpTransport(deps: TransportDeps, app: Application): void {
  const createMcpServer = () => {
    const server = new McpServer({
      name: 'shared-brain',
      version: '0.1.0',
    });
    deps.registerTools(server, { handler: deps.handler, store: deps.store, ...deps.toolDeps });
    deps.registerResources(server, { store: deps.store });
    return server;
  };

  // Landing page → redirect to app
  app.get('/', (_req: Request, res: Response) => {
    res.redirect(302, '/app');
  });

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

  // JSON API endpoint for browser use — calls handler directly, no MCP SDK/SSE
  app.post('/api/mcp', async (req: Request, res: Response) => {
    try {
      const { method, params, id } = req.body;
      if (method === 'tools/call' && params?.name && deps.handler) {
        const toolName = params.name;
        const args = params.arguments || {};
        let result: any;

        switch (toolName) {
          case 'memory_store': result = await deps.handler.handleStore(args); break;
          case 'memory_search': result = await deps.handler.handleSearch(args); break;
          case 'memory_get': result = await deps.handler.handleGet(args); break;
          case 'memory_update': result = await deps.handler.handleUpdate(args); break;
          case 'memory_delete': result = await deps.handler.handleDelete(args); break;
          case 'memory_list': result = await deps.handler.handleList(args); break;
          case 'memory_relate': result = await deps.handler.handleRelate(args); break;
          case 'memory_import': result = await deps.handler.handleImport(args); break;
          case 'memory_export': result = await deps.handler.handleExport(args); break;
          case 'sync_status': result = await deps.handler.handleSyncStatus(); break;
          case 'clear_pending_ops': {
            // Clear accumulated pending operations (no sync relay configured)
            const pending = await deps.store.getPendingOperations();
            // Mark all as synced by updating the database directly
            if (pending.length > 0 && (deps.store as any).db) {
              (deps.store as any).db.run('UPDATE operations SET synced = 1 WHERE synced = 0');
              const data = (deps.store as any).db.export();
              const { writeFileSync } = await import('fs');
              const dbPath = process.env['DB_PATH'] || '';
              if (dbPath) writeFileSync(dbPath, Buffer.from(data));
            }
            result = { cleared: pending.length, message: `Cleared ${pending.length} pending operations` };
            break;
          }
          case 'memory_reembed': {
            // Re-embed all memories with current embedding engine
            const memories = await deps.store.listMemories({ limit: 10000, offset: 0 });
            let count = 0;
            for (const m of memories) {
              if (m.content) {
                const emb = await deps.handler['embeddings'].embed(m.content);
                await deps.store.updateMemory(m.id, { embedding: emb } as any);
                deps.handler['vectorIndex'].add(m.id, emb);
                count++;
              }
            }
            result = { reembedded: count, message: `Re-embedded ${count} memories with current engine` };
            break;
          }
          default: result = { error: `Unknown tool: ${toolName}` };
        }

        res.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
        });
      } else {
        res.status(400).json({ error: 'Invalid request. Use method: tools/call with params.name' });
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Internal error' });
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

  // Old /ui endpoint → redirect to /app
  app.get('/ui', (_req: Request, res: Response) => {
    res.redirect(302, '/app');
  });

  // /app is handled by registerApp() in app.ts — do NOT register here
}

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain — Persistent Memory for AI Agents</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#232F3E;--surface:#2a3a4a;--border:#3a4a5a;--text:#F5F3EF;--muted:#a0aab4;--accent:#FF6100;--accent-dim:#cc4e00;--success:#10b981;--card:#1e2d3d;--hover:#2f4050}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
.landing-wrap{max-width:1100px;margin:0 auto;padding:40px 24px 60px}
.hero{text-align:center;margin-bottom:48px}
.hero-logo{font-size:42px;font-weight:800;margin-bottom:8px}
.hero-logo span{color:var(--accent)}
.hero-sub{color:var(--muted);font-size:16px;max-width:520px;margin:0 auto}
.stats-row{display:flex;justify-content:center;gap:32px;margin:28px 0 40px;flex-wrap:wrap}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 28px;text-align:center;min-width:140px}
.stat-card .stat-value{font-size:28px;font-weight:700;color:var(--accent)}
.stat-card .stat-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.nav-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:48px}
.nav-card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 24px;display:flex;align-items:flex-start;gap:16px;transition:border-color .2s,box-shadow .2s,transform .15s;text-decoration:none;color:var(--text)}
.nav-card:hover{border-color:var(--accent);box-shadow:0 0 20px rgba(255,97,0,.12);transform:translateY(-2px);text-decoration:none}
.nav-card-icon{font-size:28px;flex-shrink:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:var(--surface);border-radius:10px}
.nav-card-body{flex:1;min-width:0}
.nav-card-title{font-size:15px;font-weight:600;margin-bottom:4px}
.nav-card-desc{font-size:13px;color:var(--muted);line-height:1.4}
.getting-started{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px 32px;margin-bottom:32px}
.getting-started h2{font-size:18px;font-weight:700;margin-bottom:12px;color:var(--text)}
.getting-started p{font-size:14px;color:var(--muted);margin-bottom:16px}
.config-block{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:16px;font-family:ui-monospace,monospace;font-size:12px;color:var(--text);position:relative;overflow-x:auto;line-height:1.6;white-space:pre}
.copy-btn{position:absolute;top:8px;right:8px;background:var(--accent);border:none;color:#fff;font-size:11px;padding:4px 10px;border-radius:4px;cursor:pointer;font-weight:600}
.copy-btn:hover{background:var(--accent-dim)}
.footer{text-align:center;padding:24px 0;border-top:1px solid var(--border);color:var(--muted);font-size:12px}
.footer a{color:var(--accent)}
@media(max-width:640px){.nav-grid{grid-template-columns:1fr}.stats-row{gap:16px}.stat-card{min-width:100px;padding:12px 16px}}
</style>
</head>
<body>
${getNavBar('home')}
<div class="landing-wrap">
  <div class="hero">
    <div class="hero-logo">Shared<span>Brain</span></div>
    <p class="hero-sub">Persistent, cross-agent memory layer for AI systems. Store, search, and sync context across sessions and agents via MCP.</p>
  </div>
  <div class="stats-row">
    <div class="stat-card"><div class="stat-value" id="s-memories">--</div><div class="stat-label">Memories</div></div>
    <div class="stat-card"><div class="stat-value" id="s-agents">--</div><div class="stat-label">Agents</div></div>
    <div class="stat-card"><div class="stat-value" id="s-activity">--</div><div class="stat-label">Last Activity</div></div>
  </div>
  <div class="nav-grid">
    <a href="/ui" class="nav-card"><div class="nav-card-icon">&#128200;</div><div class="nav-card-body"><div class="nav-card-title">Memory Dashboard</div><div class="nav-card-desc">Browse, search, and store memories with full filtering</div></div></a>
    <a href="/demo/organizer" class="nav-card"><div class="nav-card-icon">&#129702;</div><div class="nav-card-body"><div class="nav-card-title">Auto-Organization</div><div class="nav-card-desc">Watch memories self-organize with smart tagging and clustering</div></div></a>
    <a href="/demo/ingest" class="nav-card"><div class="nav-card-icon">&#128229;</div><div class="nav-card-body"><div class="nav-card-title">Passive Ingestion</div><div class="nav-card-desc">Capture context automatically from conversations and tools</div></div></a>
    <a href="/demo/sync" class="nav-card"><div class="nav-card-icon">&#128259;</div><div class="nav-card-body"><div class="nav-card-title">Multi-User Sync</div><div class="nav-card-desc">Real-time conflict-free sync between multiple agents</div></div></a>
    <a href="/demo/identity" class="nav-card"><div class="nav-card-icon">&#128101;</div><div class="nav-card-body"><div class="nav-card-title">Cross-Agent Identity</div><div class="nav-card-desc">Unified memory graph across different agent identities</div></div></a>
    <a href="/demo/security" class="nav-card"><div class="nav-card-icon">&#128274;</div><div class="nav-card-body"><div class="nav-card-title">Security &amp; Audit</div><div class="nav-card-desc">Access control, encryption, and full audit trail</div></div></a>
    <a href="/demo/checkin" class="nav-card"><div class="nav-card-icon">&#128218;</div><div class="nav-card-body"><div class="nav-card-title">Context Briefing</div><div class="nav-card-desc">Start sessions with intelligent context summaries</div></div></a>
    <a href="/setup" class="nav-card"><div class="nav-card-icon">&#9881;&#65039;</div><div class="nav-card-body"><div class="nav-card-title">First-Run Setup</div><div class="nav-card-desc">Configure storage, sync, and agent registration</div></div></a>
    <a href="/status" class="nav-card"><div class="nav-card-icon">&#128994;</div><div class="nav-card-body"><div class="nav-card-title">System Status</div><div class="nav-card-desc">Health checks, uptime, and performance metrics</div></div></a>
  </div>
  <div class="getting-started">
    <h2>Getting Started</h2>
    <p>Add SharedBrain to your MCP client config to give any agent persistent memory:</p>
    <div class="config-block"><button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('mcp-config').textContent)">Copy</button><code id="mcp-config">{
  "mcpServers": {
    "shared-brain": {
      "url": "http://localhost:3100/mcp",
      "transport": "streamable-http"
    }
  }
}</code></div>
  </div>
  <div class="footer">SharedBrain v0.1.0 &mdash; <a href="https://github.com/shared-brain/shared-brain" target="_blank">GitHub</a></div>
</div>
<script>
(async function loadStats() {
  try {
    const health = await fetch('/health').then(r => r.json());
    document.getElementById('s-activity').textContent = health.timestamp ? new Date(health.timestamp).toLocaleTimeString() : 'now';
  } catch { document.getElementById('s-activity').textContent = '--'; }
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'sync_status', arguments: {} } });
    const res = await fetch('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, body });
    const ct = res.headers.get('content-type') || '';
    let data;
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      for (const line of text.split('\\n')) {
        if (line.startsWith('data: ')) { try { data = JSON.parse(line.slice(6)); } catch {} }
      }
    } else { data = await res.json(); }
    if (data?.result?.content) {
      for (const c of data.result.content) {
        if (c.type === 'text') {
          try {
            const info = JSON.parse(c.text);
            document.getElementById('s-memories').textContent = info.totalMemories ?? info.memories ?? '--';
            document.getElementById('s-agents').textContent = info.connectedAgents ?? info.agents ?? '1';
          } catch {}
        }
      }
    }
  } catch {}
  // Fallback: try memory_list for count
  if (document.getElementById('s-memories').textContent === '--') {
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_list', arguments: {} } });
      const res = await fetch('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' }, body });
      const ct = res.headers.get('content-type') || '';
      let data;
      if (ct.includes('text/event-stream')) {
        const text = await res.text();
        for (const line of text.split('\\n')) {
          if (line.startsWith('data: ')) { try { data = JSON.parse(line.slice(6)); } catch {} }
        }
      } else { data = await res.json(); }
      if (data?.result?.content) {
        for (const c of data.result.content) {
          if (c.type === 'text') {
            try {
              const arr = JSON.parse(c.text);
              document.getElementById('s-memories').textContent = Array.isArray(arr) ? arr.length : (arr.memories?.length ?? '--');
            } catch {}
          }
        }
      }
    } catch {}
  }
  if (document.getElementById('s-agents').textContent === '--') document.getElementById('s-agents').textContent = '1';
})();
</script>
</body>
</html>`;

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
.layout{display:grid;grid-template-columns:240px 1fr;grid-template-rows:auto auto 1fr;min-height:calc(100vh - 46px);gap:0}
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
${getNavBar('ui')}
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

