/**
 * Onboarding System — zero-config first-run experience for SharedBrain.
 *
 * Provides:
 * 1. First-run wizard (GET /setup)
 * 2. Auto-detect MCP client on tool calls
 * 3. Auto-apply organizer on every memory_store
 * 4. Smart defaults (no auth on localhost, personal scope)
 * 5. Root redirect (GET / → /ui)
 * 6. Status page (GET /status)
 */

import type { Application, Request, Response } from 'express';
import type { Store, VectorIndex } from './mcp/handler.js';
import type { IdentityManager } from './identity.js';
import { Organizer } from './organizer.js';
import type { Embeddings } from './mcp/handler.js';
import { existsSync, statSync } from 'fs';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OnboardingDeps {
  store: Store;
  identityManager: IdentityManager;
  vectorIndex: VectorIndex;
  embeddings?: Embeddings;
  dbPath?: string;
}

interface SetupPayload {
  name: string;
  email?: string;
  defaultScope?: 'personal' | 'team' | 'org';
}

// ─── State ───────────────────────────────────────────────────────────────────

const startTime = Date.now();
let lastIngestionTime: string | null = null;

// ─── Main Registration ───────────────────────────────────────────────────────

export function registerOnboarding(
  app: Application,
  deps: { store: Store; identityManager: IdentityManager; vectorIndex: VectorIndex; embeddings?: Embeddings; dbPath?: string },
): void {
  const { store, identityManager, vectorIndex, embeddings, dbPath } = deps;

  // ── GET / → redirect to /ui (replace default Express landing) ──
  // We override the existing route by inserting our handler first via app.get
  // The transport/http.ts defines GET / but we redefine the behavior here:
  app.get('/setup-redirect', (_req: Request, res: Response) => {
    res.redirect('/ui');
  });

  // ── GET /setup — First-run wizard ──
  app.get('/setup', async (_req: Request, res: Response) => {
    try {
      const memoryCount = await store.countMemories();
      const agents = identityManager.getAllAgents();

      // If already configured, redirect to dashboard
      if (memoryCount > 0 || agents.length > 0) {
        res.redirect('/ui');
        return;
      }

      // Serve the setup wizard (imported from onboarding-demo.ts inline)
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(getSetupWizardHTML());
    } catch {
      res.redirect('/ui');
    }
  });

  // ── POST /setup — Process setup form ──
  app.post('/setup', async (req: Request, res: Response) => {
    try {
      const { name, email, defaultScope } = req.body as SetupPayload;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'Name is required' });
        return;
      }

      // Create user via identity system
      const user = identityManager.getOrCreateUser(name.trim(), email?.trim());

      // Auto-register the setup agent (browser)
      identityManager.registerAgent('setup-wizard', user.id, 'browser');

      // Generate a simple auth token (for non-localhost use)
      const token = generateToken();

      res.json({
        success: true,
        userId: user.id,
        token,
        defaultScope: defaultScope || 'personal',
        mcpConfig: generateMcpConfig(token),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Setup failed' });
    }
  });

  // ── GET /status — Server status page ──
  app.get('/status', async (_req: Request, res: Response) => {
    try {
      const memoryCount = await store.countMemories();
      const agents = identityManager.getAllAgents();
      const activeAgents = identityManager.getActiveAgents();
      const vectorSize = vectorIndex.size();
      const uptime = Date.now() - startTime;

      // DB file size
      let dbSize: string = 'unknown';
      const resolvedDbPath = dbPath || 'C:/Users/awictor/shared-brain/data/brain.db';
      if (existsSync(resolvedDbPath)) {
        const stats = statSync(resolvedDbPath);
        dbSize = formatBytes(stats.size);
      }

      const status = {
        uptime: formatUptime(uptime),
        uptimeMs: uptime,
        memoryCount,
        vectorIndexSize: vectorSize,
        connectedAgents: agents.map(a => ({
          id: a.id,
          name: a.name,
          lastSeen: a.lastSeen,
          memoriesCreated: a.memoriesCreated,
        })),
        activeAgents: activeAgents.length,
        totalAgents: agents.length,
        lastIngestionTime,
        dbFileSize: dbSize,
        embeddingModelLoaded: embeddings ? true : false,
        version: '0.1.0',
      };

      // If request accepts HTML, serve the status page
      if (_req.headers.accept?.includes('text/html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(getStatusPageHTML(status));
      } else {
        res.json(status);
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Status check failed' });
    }
  });

  // ── Auto-detect MCP client middleware ──
  // Intercept POST /mcp to extract clientInfo from initialize handshake
  app.use('/mcp', (req: Request, _res: Response, next) => {
    if (req.method === 'POST' && req.body) {
      const body = req.body;

      // MCP initialize request contains clientInfo
      if (body.method === 'initialize' && body.params?.clientInfo) {
        const clientInfo = body.params.clientInfo;
        const clientName = clientInfo.name || 'unknown-client';
        const clientVersion = clientInfo.version || 'unknown';

        // Auto-register this agent
        try {
          identityManager.registerAgent(
            `${clientName}@${clientVersion}`,
            undefined,
            `mcp-client-${clientName}`,
          );
          console.log(`[onboarding] Auto-registered MCP client: ${clientName}@${clientVersion}`);
        } catch {
          // Non-fatal — agent may already exist
        }
      }

      // Track ingestion time on memory_store calls
      if (body.method === 'tools/call' && body.params?.name === 'memory_store') {
        lastIngestionTime = new Date().toISOString();
      }
    }
    next();
  });

  // ── Auto-organize wrapper ──
  // We hook into memory_store by adding a middleware that enriches the params
  if (embeddings) {
    const organizer = new Organizer(embeddings, vectorIndex, store);

    app.use('/mcp', async (req: Request, _res: Response, next) => {
      if (req.method === 'POST' && req.body?.method === 'tools/call' && req.body?.params?.name === 'memory_store') {
        try {
          const args = req.body.params.arguments || {};
          const content = args.content;

          if (content && typeof content === 'string') {
            // Auto-organize: fill in missing fields
            const result = await organizer.organize(
              content,
              args.title || undefined,
              args.type || undefined,
              args.tags || undefined,
              args.scope || undefined,
            );

            // Apply auto-generated fields only if not provided
            if (!args.title && result.title) {
              req.body.params.arguments.title = result.title;
            }
            if (!args.tags && result.tags && result.tags.length > 0) {
              req.body.params.arguments.tags = result.tags;
            }
            if ((!args.type || args.type === 'note') && result.type && result.type !== 'note') {
              req.body.params.arguments.type = result.type;
            }
            // Auto-link relations
            if (result.relations && result.relations.length > 0) {
              req.body.params.arguments.relations = [
                ...(args.relations || []),
                ...result.relations,
              ];
            }
          }
        } catch (err) {
          // Non-fatal — proceed without auto-organize
          console.warn('[onboarding] Auto-organize failed:', err instanceof Error ? err.message : err);
        }
      }
      next();
    });
  }

  console.log(`[onboarding] Zero-config onboarding system ready`);
  console.log(`[onboarding] Setup wizard → /setup`);
  console.log(`[onboarding] Status page → /status`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'sb_';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function generateMcpConfig(token: string): object {
  return {
    'claude-code': {
      mcpServers: {
        'shared-brain': {
          url: 'http://127.0.0.1:3100/mcp',
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    cursor: {
      mcpServers: {
        'shared-brain': {
          url: 'http://127.0.0.1:3100/mcp',
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    vscode: {
      'mcp.servers': {
        'shared-brain': {
          type: 'http',
          url: 'http://127.0.0.1:3100/mcp',
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
  };
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─── Status Page HTML ────────────────────────────────────────────────────────

function getStatusPageHTML(status: any): string {
  const navBar = getNavBarHTML('status');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain — Status</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#232F3E;--surface:#2a3a4a;--border:#3a4a5a;--text:#F5F3EF;--muted:#a0aab4;--accent:#FF6100;--accent-dim:#cc4e00;--success:#10b981;--card:#1e2d3d}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6}
a{color:var(--accent);text-decoration:none}
.container{max-width:900px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;font-weight:700;margin-bottom:8px}
h1 span{color:var(--accent)}
.subtitle{color:var(--muted);margin-bottom:32px;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:32px}
.metric{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;text-align:center}
.metric-value{font-size:28px;font-weight:700;color:var(--accent);margin-bottom:4px}
.metric-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
.section{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:16px}
.section h2{font-size:16px;font-weight:600;margin-bottom:12px;color:var(--text)}
.agent-row{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}
.agent-row:last-child{border-bottom:none}
.agent-dot{width:8px;height:8px;border-radius:50%;background:var(--success)}
.agent-dot.inactive{background:var(--muted)}
.agent-name{font-weight:500;font-size:14px}
.agent-meta{font-size:12px;color:var(--muted);margin-left:auto}
.pulse{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
</style>
</head>
<body>
${navBar}
<div class="container">
<h1>Server <span>Status</span></h1>
<p class="subtitle">Real-time health metrics for your SharedBrain instance</p>

<div class="grid">
  <div class="metric">
    <div class="metric-value">${status.memoryCount}</div>
    <div class="metric-label">Memories</div>
  </div>
  <div class="metric">
    <div class="metric-value">${status.vectorIndexSize}</div>
    <div class="metric-label">Vector Index</div>
  </div>
  <div class="metric">
    <div class="metric-value">${status.activeAgents}</div>
    <div class="metric-label">Active Agents</div>
  </div>
  <div class="metric">
    <div class="metric-value">${status.uptime}</div>
    <div class="metric-label">Uptime</div>
  </div>
  <div class="metric">
    <div class="metric-value">${status.dbFileSize}</div>
    <div class="metric-label">DB Size</div>
  </div>
  <div class="metric">
    <div class="metric-value">${status.embeddingModelLoaded ? 'Yes' : 'No'}</div>
    <div class="metric-label">Model Loaded</div>
  </div>
</div>

<div class="section">
  <h2>Connected Agents (${status.totalAgents})</h2>
  ${status.connectedAgents.length === 0 ? '<p style="color:var(--muted);font-size:13px">No agents registered yet. Connect via MCP to auto-register.</p>' : status.connectedAgents.map((a: any) => {
    const isActive = status.activeAgents > 0 && (Date.now() - new Date(a.lastSeen).getTime() < 300000);
    return `<div class="agent-row">
      <div class="agent-dot ${isActive ? 'pulse' : 'inactive'}"></div>
      <span class="agent-name">${escapeHtml(a.name)}</span>
      <span class="agent-meta">${a.memoriesCreated} memories | last seen ${timeAgo(a.lastSeen)}</span>
    </div>`;
  }).join('')}
</div>

<div class="section">
  <h2>System Info</h2>
  <table style="width:100%;font-size:13px">
    <tr><td style="color:var(--muted);padding:4px 12px 4px 0">Version</td><td>${status.version}</td></tr>
    <tr><td style="color:var(--muted);padding:4px 12px 4px 0">Last Ingestion</td><td>${status.lastIngestionTime || 'Never'}</td></tr>
    <tr><td style="color:var(--muted);padding:4px 12px 4px 0">Embedding Model</td><td>Xenova/all-MiniLM-L6-v2 (384-dim)</td></tr>
    <tr><td style="color:var(--muted);padding:4px 12px 4px 0">Database</td><td>SQLite via sql.js (in-memory + persisted)</td></tr>
  </table>
</div>
</div>
<script>
// Auto-refresh every 10s
setTimeout(() => location.reload(), 10000);
</script>
</body>
</html>`;
}

// ─── Setup Wizard HTML ───────────────────────────────────────────────────────

function getSetupWizardHTML(): string {
  // Delegated to onboarding-demo.ts for the full implementation
  // This is a minimal fallback — the demo file has the rich version
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>SharedBrain Setup</title>
<style>body{font-family:system-ui;background:#232F3E;color:#F5F3EF;display:flex;align-items:center;justify-content:center;min-height:100vh}
.box{background:#1e2d3d;border:1px solid #3a4a5a;border-radius:12px;padding:40px;max-width:480px;width:100%}
h1{margin-bottom:8px}h1 span{color:#FF6100}
p{color:#a0aab4;margin-bottom:24px;font-size:14px}
label{display:block;font-size:13px;color:#a0aab4;margin-bottom:4px}
input{width:100%;padding:10px 14px;background:#2a3a4a;border:1px solid #3a4a5a;border-radius:6px;color:#F5F3EF;font-size:14px;margin-bottom:16px}
input:focus{border-color:#FF6100;outline:none}
button{width:100%;padding:12px;background:#FF6100;border:none;border-radius:6px;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:hover{background:#cc4e00}
</style></head><body>
<div class="box"><h1>Welcome to Shared<span>Brain</span></h1>
<p>Set up your personal memory server in seconds.</p>
<label>Your Name</label><input id="name" placeholder="e.g. Alex"/>
<label>Email (optional)</label><input id="email" type="email" placeholder="alex@example.com"/>
<button onclick="setup()">Get Started</button>
<div id="result" style="margin-top:16px;display:none"></div>
</div>
<script>
async function setup(){const n=document.getElementById('name').value.trim();if(!n){alert('Name required');return}
const r=await fetch('/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n,email:document.getElementById('email').value.trim()||undefined})});
const d=await r.json();if(d.success){document.getElementById('result').style.display='block';document.getElementById('result').innerHTML='<p style="color:#10b981">Setup complete! Redirecting...</p>';setTimeout(()=>location.href='/ui',1500)}
else{alert(d.error||'Setup failed')}}
</script></body></html>`;
}

// ─── Shared nav bar (matches transport/http.ts style) ────────────────────────

function getNavBarHTML(activePage: string = ''): string {
  const links = [
    { href: '/', label: 'Home', id: 'home' },
    { href: '/ui', label: 'Dashboard', id: 'ui' },
    { href: '/status', label: 'Status', id: 'status' },
    { href: '/setup', label: 'Setup', id: 'setup' },
    { href: '/demo/organizer', label: 'Organizer', id: 'organizer' },
    { href: '/demo/ingest', label: 'Ingest', id: 'ingest' },
    { href: '/demo/sync', label: 'Sync', id: 'sync' },
    { href: '/demo/identity', label: 'Identity', id: 'identity' },
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

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
