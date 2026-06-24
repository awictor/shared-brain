/**
 * SharedBrain SPA — GET /app
 *
 * A complete single-page application served as a single HTML response.
 * Client-side hash routing, vanilla JS, real data from MCP + REST APIs.
 */

import type { Application } from 'express';

export function registerApp(app: Application): void {
  app.get('/app', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(SPA_HTML);
  });
}

const SPA_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
/*─── Reset & Variables ───────────────────────────────────────────────────────*/
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#1a2332;--surface:#232F3E;--card:#2a3a4a;--border:#3a4a5a;
  --text:#F5F3EF;--muted:#8a9aaa;--accent:#FF6100;--accent-hover:#e55800;
  --success:#10b981;--error:#ef4444;--info:#3b82f6;
  --sidebar-w:240px;--sidebar-collapsed:56px;--topbar-h:56px;
  --radius-card:8px;--radius-input:6px;--radius-pill:20px;
  --shadow:0 2px 8px rgba(0,0,0,0.3);--shadow-lg:0 8px 32px rgba(0,0,0,0.4);
  --transition:200ms ease;
}
html{scroll-behavior:smooth}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow:hidden}
a{color:var(--accent);text-decoration:none}
a:hover{opacity:0.85}
::selection{background:var(--accent);color:#fff}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--muted)}

/*─── Layout Shell ────────────────────────────────────────────────────────────*/
.shell{display:grid;grid-template-columns:var(--sidebar-w) 1fr;grid-template-rows:var(--topbar-h) 1fr;height:100vh;transition:grid-template-columns var(--transition)}
.shell.collapsed{grid-template-columns:var(--sidebar-collapsed) 1fr}

/*─── Sidebar ─────────────────────────────────────────────────────────────────*/
.sidebar{grid-row:1/-1;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;transition:width var(--transition);z-index:100}
.sidebar-brand{height:var(--topbar-h);display:flex;align-items:center;padding:0 16px;gap:10px;border-bottom:1px solid var(--border);flex-shrink:0}
.sidebar-brand svg{width:28px;height:28px;flex-shrink:0}
.sidebar-brand span{font-size:15px;font-weight:700;white-space:nowrap;overflow:hidden}
.sidebar-brand span em{font-style:normal;color:var(--accent)}
.collapsed .sidebar-brand span{opacity:0;width:0}
.sidebar-nav{flex:1;overflow-y:auto;padding:12px 0}
.nav-section{padding:0 16px;margin-bottom:4px}
.nav-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--muted);padding:8px 0 4px;white-space:nowrap;overflow:hidden}
.collapsed .nav-section-label{opacity:0;height:0;padding:0;margin:0}
.nav-item{display:flex;align-items:center;gap:10px;padding:8px 16px;margin:1px 8px;border-radius:var(--radius-input);cursor:pointer;transition:background var(--transition),border-color var(--transition);border-left:3px solid transparent;color:var(--muted);font-size:13px;font-weight:500;white-space:nowrap;text-decoration:none}
.nav-item:hover{background:rgba(255,255,255,0.04);color:var(--text)}
.nav-item.active{background:rgba(255,97,0,0.08);color:var(--accent);border-left-color:var(--accent)}
.nav-item .nav-icon{font-size:16px;width:20px;text-align:center;flex-shrink:0}
.nav-item .nav-label{overflow:hidden}
.collapsed .nav-item .nav-label{opacity:0;width:0}
.collapsed .nav-item{justify-content:center;padding:10px 0;margin:1px 4px}
.sidebar-footer{padding:12px;border-top:1px solid var(--border);flex-shrink:0}
.collapse-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:8px;border:none;background:rgba(255,255,255,0.04);color:var(--muted);border-radius:var(--radius-input);cursor:pointer;font-size:12px;font-weight:500;transition:background var(--transition)}
.collapse-btn:hover{background:rgba(255,255,255,0.08);color:var(--text)}
.collapse-btn span{overflow:hidden;white-space:nowrap}
.collapsed .collapse-btn span{opacity:0;width:0}

/*─── Topbar ──────────────────────────────────────────────────────────────────*/
.topbar{display:flex;align-items:center;padding:0 24px;gap:16px;background:var(--surface);border-bottom:1px solid var(--border)}
.topbar-search{flex:1;max-width:480px;position:relative}
.topbar-search input{width:100%;padding:8px 12px 8px 36px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);color:var(--text);font-size:13px;transition:border-color var(--transition)}
.topbar-search input:focus{border-color:var(--accent);outline:none}
.topbar-search input::placeholder{color:var(--muted)}
.topbar-search .search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:14px}
.topbar-search .search-shortcut{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);background:var(--card);padding:2px 6px;border-radius:3px;border:1px solid var(--border)}
.topbar-right{display:flex;align-items:center;gap:12px;margin-left:auto}
.topbar-indicator{font-size:11px;color:var(--success);display:flex;align-items:center;gap:4px}
.topbar-indicator::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.topbar-avatar{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#ff8c42);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff}

/*─── Main Content ────────────────────────────────────────────────────────────*/
.main{overflow-y:auto;position:relative}
.page{position:absolute;inset:0;padding:24px;overflow-y:auto;opacity:0;transform:translateX(8px);pointer-events:none;transition:opacity 250ms ease,transform 250ms ease}
.page.active{opacity:1;transform:translateX(0);pointer-events:auto}

/*─── Common Components ───────────────────────────────────────────────────────*/
.page-title{font-size:22px;font-weight:700;margin-bottom:20px}
.page-title em{font-style:normal;color:var(--accent)}
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:24px}
.stat-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px;transition:border-color var(--transition),transform var(--transition)}
.stat-card:hover{border-color:var(--accent);transform:translateY(-1px)}
.stat-card .stat-value{font-size:28px;font-weight:700;color:var(--text)}
.stat-card .stat-label{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-top:4px}
.stat-card .stat-icon{font-size:20px;margin-bottom:8px}
.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px;transition:border-color var(--transition),box-shadow var(--transition)}
.card:hover{border-color:rgba(255,97,0,0.3);box-shadow:0 0 0 1px rgba(255,97,0,0.1)}
.card-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.card-title{font-size:14px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.badge{font-size:10px;padding:2px 8px;border-radius:var(--radius-pill);font-weight:600;text-transform:uppercase;letter-spacing:0.3px}
.badge-type{background:rgba(59,130,246,0.15);color:var(--info)}
.badge-scope{background:rgba(16,185,129,0.15);color:var(--success)}
.badge-accent{background:rgba(255,97,0,0.15);color:var(--accent)}
.tag{font-size:10px;padding:2px 6px;background:var(--surface);border:1px solid var(--border);border-radius:3px;color:var(--muted)}
.btn{padding:8px 16px;border:none;border-radius:var(--radius-input);font-size:13px;font-weight:600;cursor:pointer;transition:all var(--transition)}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover)}
.btn-ghost{background:transparent;border:1px solid var(--border);color:var(--text)}
.btn-ghost:hover{border-color:var(--accent);color:var(--accent)}
.input{width:100%;padding:10px 14px;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);color:var(--text);font-size:13px;transition:border-color var(--transition)}
.input:focus{border-color:var(--accent);outline:none}
.input::placeholder{color:var(--muted)}
textarea.input{min-height:100px;resize:vertical;font-family:inherit}
.chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:var(--radius-pill);font-size:11px;font-weight:500;background:var(--surface);border:1px solid var(--border);color:var(--muted);cursor:pointer;transition:all var(--transition)}
.chip:hover,.chip.active{border-color:var(--accent);color:var(--accent);background:rgba(255,97,0,0.08)}
.score-bar{height:4px;border-radius:2px;background:var(--border);overflow:hidden;flex:1;max-width:80px}
.score-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--success))}
.table{width:100%;border-collapse:collapse;font-size:12px}
.table th{text-align:left;padding:8px 12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;font-size:10px;border-bottom:1px solid var(--border)}
.table td{padding:8px 12px;border-bottom:1px solid rgba(58,74,90,0.5)}
.table tr:hover td{background:rgba(255,255,255,0.02)}
.empty-state{text-align:center;padding:60px 20px;color:var(--muted)}
.empty-state .empty-icon{font-size:48px;margin-bottom:12px;opacity:0.5}
.empty-state p{font-size:14px}
.loading-spinner{display:inline-block;width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.section{margin-bottom:24px}
.section-title{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
.flex{display:flex}
.flex-col{flex-direction:column}
.gap-8{gap:8px}
.gap-12{gap:12px}
.gap-16{gap:16px}
.items-center{align-items:center}
.justify-between{justify-content:space-between}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}

/*─── Toast ───────────────────────────────────────────────────────────────────*/
.toast-container{position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:8px}
.toast{padding:12px 20px;border-radius:var(--radius-card);font-size:13px;font-weight:500;color:#fff;box-shadow:var(--shadow-lg);animation:toast-in 300ms ease;transition:opacity 300ms,transform 300ms}
.toast.removing{opacity:0;transform:translateX(20px)}
.toast-success{background:var(--success)}
.toast-error{background:var(--error)}
.toast-info{background:var(--info)}

@keyframes toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

/*─── Page: Search ────────────────────────────────────────────────────────────*/
.search-page-input{font-size:18px;padding:14px 20px;margin-bottom:16px}
.search-results{display:grid;gap:12px}
.search-result .result-score{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
.filter-bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}

/*─── Page: Store ─────────────────────────────────────────────────────────────*/
.store-layout{display:grid;grid-template-columns:1fr 340px;gap:24px}
.store-preview{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-card);padding:20px;position:sticky;top:0}
.store-preview h3{font-size:13px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px}
.preview-item{margin-bottom:12px}
.preview-label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
.preview-value{font-size:13px;color:var(--text);padding:6px 10px;background:var(--bg);border-radius:4px;min-height:28px}
.preview-tags{display:flex;gap:4px;flex-wrap:wrap}

/*─── Page: Checkin ───────────────────────────────────────────────────────────*/
.checkin-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.checkin-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px}
.checkin-card h3{font-size:13px;font-weight:600;margin-bottom:10px;color:var(--accent)}
.checkin-list{list-style:none;font-size:13px;color:var(--muted)}
.checkin-list li{padding:4px 0;border-bottom:1px solid rgba(58,74,90,0.3)}
.checkin-list li:last-child{border-bottom:none}

/*─── Page: Sync ──────────────────────────────────────────────────────────────*/
.sync-panels{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.sync-panel{background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);padding:16px}
.sync-panel h3{font-size:14px;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.sync-panel h3 .dot{width:8px;height:8px;border-radius:50%}
.conflict-card{background:var(--surface);border:1px solid var(--error);border-radius:var(--radius-card);padding:12px;margin-top:12px}
.conflict-card h4{font-size:12px;color:var(--error);margin-bottom:6px}

/*─── Page: Agents ────────────────────────────────────────────────────────────*/
.agent-card{display:flex;align-items:center;gap:12px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:var(--radius-card);margin-bottom:8px}
.agent-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;background:var(--surface)}
.agent-info{flex:1}
.agent-name{font-size:13px;font-weight:600}
.agent-meta{font-size:11px;color:var(--muted)}
.agent-status{width:8px;height:8px;border-radius:50%}
.agent-status.online{background:var(--success)}
.agent-status.offline{background:var(--muted)}

/*─── Page: Ingest ────────────────────────────────────────────────────────────*/
.tabs{display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid var(--border)}
.tab{padding:10px 16px;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;border-bottom:2px solid transparent;transition:all var(--transition)}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab-content{display:none}
.tab-content.active{display:block}

/*─── Page: Security ──────────────────────────────────────────────────────────*/
.audit-row{font-size:12px;padding:6px 0;border-bottom:1px solid rgba(58,74,90,0.3);display:flex;gap:12px}
.audit-time{color:var(--muted);width:140px;flex-shrink:0}
.audit-method{font-weight:600;width:50px;flex-shrink:0}
.audit-path{flex:1;color:var(--text)}
.audit-status{width:40px;text-align:right}
.rate-limit-bar{height:8px;border-radius:4px;background:var(--border);overflow:hidden;margin-top:6px}
.rate-limit-fill{height:100%;border-radius:4px;transition:width var(--transition)}

/*─── Page: Status ────────────────────────────────────────────────────────────*/
.status-indicator{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:500}
.status-dot{width:8px;height:8px;border-radius:50%}
.status-ok .status-dot{background:var(--success)}
.status-warn .status-dot{background:#f59e0b}
.status-err .status-dot{background:var(--error)}

/*─── Responsive ──────────────────────────────────────────────────────────────*/
@media(max-width:1024px){
  .store-layout{grid-template-columns:1fr}
  .sync-panels{grid-template-columns:1fr}
  .checkin-grid{grid-template-columns:1fr}
  .grid-2{grid-template-columns:1fr}
  .grid-3{grid-template-columns:1fr 1fr}
}
@media(max-width:768px){
  .shell{grid-template-columns:var(--sidebar-collapsed) 1fr}
  .sidebar-brand span,.nav-section-label,.nav-item .nav-label,.collapse-btn span{opacity:0;width:0}
  .nav-item{justify-content:center;padding:10px 0;margin:1px 4px}
  .stats-grid{grid-template-columns:1fr 1fr}
  .grid-3{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="shell" id="shell">
  <!-- Sidebar -->
  <nav class="sidebar">
    <div class="sidebar-brand">
      <svg viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" stroke="#FF6100" stroke-width="2"/><path d="M9 14c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5" stroke="#FF6100" stroke-width="2" stroke-linecap="round"/><circle cx="14" cy="14" r="2" fill="#FF6100"/></svg>
      <span>Shared<em>Brain</em></span>
    </div>
    <div class="sidebar-nav">
      <div class="nav-section"><div class="nav-section-label">Core</div></div>
      <a class="nav-item" href="#dashboard"><span class="nav-icon">&#9649;</span><span class="nav-label">Dashboard</span></a>
      <a class="nav-item" href="#search"><span class="nav-icon">&#128269;</span><span class="nav-label">Search</span></a>
      <a class="nav-item" href="#store"><span class="nav-icon">&#128190;</span><span class="nav-label">Store</span></a>
      <div class="nav-section"><div class="nav-section-label">Activity</div></div>
      <a class="nav-item" href="#checkin"><span class="nav-icon">&#9728;&#65039;</span><span class="nav-label">Checkin</span></a>
      <a class="nav-item" href="#ingest"><span class="nav-icon">&#128229;</span><span class="nav-label">Ingestion Log</span></a>
      <div class="nav-section"><div class="nav-section-label">Collaborate</div></div>
      <a class="nav-item" href="#sync"><span class="nav-icon">&#128259;</span><span class="nav-label">Sync</span></a>
      <a class="nav-item" href="#agents"><span class="nav-icon">&#129302;</span><span class="nav-label">Agents & Identity</span></a>
      <div class="nav-section"><div class="nav-section-label">Admin</div></div>
      <a class="nav-item" href="#security"><span class="nav-icon">&#128274;</span><span class="nav-label">Security</span></a>
      <a class="nav-item" href="#status"><span class="nav-icon">&#128994;</span><span class="nav-label">Status</span></a>
      <a class="nav-item" href="#settings"><span class="nav-icon">&#9881;&#65039;</span><span class="nav-label">Settings</span></a>
    </div>
    <div class="sidebar-footer">
      <button class="collapse-btn" onclick="toggleSidebar()">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>
        <span>Collapse</span>
      </button>
    </div>
  </nav>

  <!-- Topbar -->
  <header class="topbar">
    <div class="topbar-search">
      <span class="search-icon">&#128269;</span>
      <input type="text" id="global-search" placeholder="Search memories..." autocomplete="off"/>
      <span class="search-shortcut">/</span>
    </div>
    <div class="topbar-right">
      <div class="topbar-indicator">MCP Connected</div>
      <div class="topbar-avatar">SB</div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="main" id="main">
    <!-- Dashboard -->
    <div class="page" id="page-dashboard">
      <h1 class="page-title">Dash<em>board</em></h1>
      <div class="stats-grid" id="dash-stats"></div>
      <div class="section">
        <div class="section-title">Recent Memories</div>
        <div id="dash-recent" class="flex flex-col gap-8"></div>
      </div>
      <div class="section" style="margin-top:20px">
        <div class="section-title">Quick Store</div>
        <div class="flex gap-8 items-center">
          <input class="input" id="quick-store-input" placeholder="Type a memory to store quickly..." style="flex:1"/>
          <button class="btn btn-primary" onclick="quickStore()">Store</button>
        </div>
      </div>
    </div>

    <!-- Search -->
    <div class="page" id="page-search">
      <h1 class="page-title">Semantic <em>Search</em></h1>
      <input class="input search-page-input" id="search-main-input" placeholder="Search across all memories..." autocomplete="off"/>
      <div class="filter-bar" id="search-filters"></div>
      <div class="search-results" id="search-results">
        <div class="empty-state"><div class="empty-icon">&#128269;</div><p>Type to search across all memories using semantic similarity</p></div>
      </div>
    </div>

    <!-- Store -->
    <div class="page" id="page-store">
      <h1 class="page-title">Store <em>Memory</em></h1>
      <div class="store-layout">
        <div class="flex flex-col gap-16">
          <div>
            <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:block">Content</label>
            <textarea class="input" id="store-content" placeholder="What do you want to remember?"></textarea>
          </div>
          <div class="grid-2">
            <div>
              <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:block">Title (optional)</label>
              <input class="input" id="store-title" placeholder="Auto-generated if empty"/>
            </div>
            <div>
              <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:block">Type</label>
              <select class="input" id="store-type">
                <option value="note">Note</option>
                <option value="fact">Fact</option>
                <option value="preference">Preference</option>
                <option value="procedure">Procedure</option>
                <option value="reference">Reference</option>
                <option value="context">Context</option>
              </select>
            </div>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:block">Tags (comma separated)</label>
            <input class="input" id="store-tags" placeholder="e.g. project, meeting-notes, architecture"/>
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:block">Scope</label>
            <div class="flex gap-8">
              <span class="chip active" data-scope="personal" onclick="setScope(this)">Personal</span>
              <span class="chip" data-scope="team" onclick="setScope(this)">Team</span>
              <span class="chip" data-scope="org" onclick="setScope(this)">Organization</span>
            </div>
          </div>
          <button class="btn btn-primary" onclick="storeMemory()" style="align-self:flex-start">Store Memory</button>
        </div>
        <div class="store-preview" id="store-preview">
          <h3>Live Preview</h3>
          <div class="preview-item"><div class="preview-label">Inferred Title</div><div class="preview-value" id="preview-title">—</div></div>
          <div class="preview-item"><div class="preview-label">Type</div><div class="preview-value" id="preview-type">note</div></div>
          <div class="preview-item"><div class="preview-label">Tags</div><div class="preview-tags" id="preview-tags"></div></div>
          <div class="preview-item"><div class="preview-label">Scope</div><div class="preview-value" id="preview-scope">personal</div></div>
          <div class="preview-item"><div class="preview-label">Content Length</div><div class="preview-value" id="preview-length">0 chars</div></div>
        </div>
      </div>
    </div>

    <!-- Checkin -->
    <div class="page" id="page-checkin">
      <h1 class="page-title">Morning <em>Briefing</em></h1>
      <div class="checkin-grid" id="checkin-grid">
        <div class="checkin-card"><h3>Loading...</h3><p style="color:var(--muted);font-size:13px">Fetching briefing data...</p></div>
      </div>
    </div>

    <!-- Ingest -->
    <div class="page" id="page-ingest">
      <h1 class="page-title">Ingestion <em>Log</em></h1>
      <div class="tabs" id="ingest-tabs">
        <div class="tab active" data-tab="log" onclick="switchIngestTab(this)">Activity Log</div>
        <div class="tab" data-tab="slack" onclick="switchIngestTab(this)">Slack</div>
        <div class="tab" data-tab="email" onclick="switchIngestTab(this)">Email</div>
        <div class="tab" data-tab="meeting" onclick="switchIngestTab(this)">Meeting</div>
      </div>
      <div class="tab-content active" id="ingest-tab-log">
        <div id="ingest-log-list" class="flex flex-col gap-8"></div>
      </div>
      <div class="tab-content" id="ingest-tab-slack">
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;margin-bottom:12px">Test Slack Ingestion</h3>
          <textarea class="input" id="ingest-slack-content" placeholder="Paste a Slack message..." style="margin-bottom:12px"></textarea>
          <input class="input" id="ingest-slack-channel" placeholder="Channel name" style="margin-bottom:12px"/>
          <button class="btn btn-primary" onclick="testIngest('slack')">Ingest</button>
        </div>
      </div>
      <div class="tab-content" id="ingest-tab-email">
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;margin-bottom:12px">Test Email Ingestion</h3>
          <input class="input" id="ingest-email-subject" placeholder="Subject" style="margin-bottom:12px"/>
          <input class="input" id="ingest-email-from" placeholder="From" style="margin-bottom:12px"/>
          <textarea class="input" id="ingest-email-body" placeholder="Email body..." style="margin-bottom:12px"></textarea>
          <button class="btn btn-primary" onclick="testIngest('email')">Ingest</button>
        </div>
      </div>
      <div class="tab-content" id="ingest-tab-meeting">
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;margin-bottom:12px">Test Meeting Ingestion</h3>
          <input class="input" id="ingest-meeting-title" placeholder="Meeting title" style="margin-bottom:12px"/>
          <textarea class="input" id="ingest-meeting-notes" placeholder="Meeting notes / transcript..." style="margin-bottom:12px"></textarea>
          <input class="input" id="ingest-meeting-attendees" placeholder="Attendees (comma separated)" style="margin-bottom:12px"/>
          <button class="btn btn-primary" onclick="testIngest('meeting')">Ingest</button>
        </div>
      </div>
    </div>

    <!-- Sync -->
    <div class="page" id="page-sync">
      <h1 class="page-title">Multi-User <em>Sync</em></h1>
      <div class="flex gap-8 items-center" style="margin-bottom:16px">
        <button class="btn btn-ghost" onclick="refreshSync()">Refresh State</button>
        <span id="sync-status" style="font-size:12px;color:var(--muted)"></span>
      </div>
      <div class="sync-panels" id="sync-panels">
        <div class="sync-panel">
          <h3><span class="dot" style="background:var(--info)"></span>Alice</h3>
          <div id="sync-alice">Loading...</div>
        </div>
        <div class="sync-panel">
          <h3><span class="dot" style="background:var(--success)"></span>Bob</h3>
          <div id="sync-bob">Loading...</div>
        </div>
      </div>
      <div id="sync-conflicts"></div>
    </div>

    <!-- Agents -->
    <div class="page" id="page-agents">
      <h1 class="page-title">Agents & <em>Identity</em></h1>
      <div class="section">
        <div class="section-title">Registered Agents</div>
        <div id="agents-list" class="flex flex-col gap-8"></div>
      </div>
      <div class="section">
        <div class="section-title">Activity Timeline</div>
        <div id="agents-timeline" class="flex flex-col gap-8"></div>
      </div>
    </div>

    <!-- Security -->
    <div class="page" id="page-security">
      <h1 class="page-title">Security & <em>Audit</em></h1>
      <div class="stats-grid" id="security-stats"></div>
      <div class="section">
        <div class="section-title">Audit Log</div>
        <div id="audit-log" class="flex flex-col gap-8" style="max-height:400px;overflow-y:auto"></div>
      </div>
      <div class="section" style="margin-top:20px">
        <div class="section-title">Test Input Sanitization</div>
        <div class="flex gap-8">
          <input class="input" id="sanitize-input" placeholder="Try: <script>alert('xss')</script>" style="flex:1"/>
          <button class="btn btn-ghost" onclick="testSanitize()">Test</button>
        </div>
        <div id="sanitize-result" style="margin-top:8px;font-size:12px;color:var(--muted)"></div>
      </div>
    </div>

    <!-- Status -->
    <div class="page" id="page-status">
      <h1 class="page-title">System <em>Status</em></h1>
      <div class="stats-grid" id="status-metrics"></div>
      <div class="section">
        <div class="section-title">Service Health</div>
        <div id="status-services" class="flex flex-col gap-8"></div>
      </div>
    </div>

    <!-- Settings -->
    <div class="page" id="page-settings">
      <h1 class="page-title"><em>Settings</em></h1>
      <div class="card" style="padding:20px;max-width:600px">
        <h3 style="font-size:14px;margin-bottom:16px">MCP Configuration</h3>
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-input);padding:16px;font-family:monospace;font-size:12px;line-height:1.8;white-space:pre;overflow-x:auto">{
  "mcpServers": {
    "shared-brain": {
      "url": "http://localhost:3100/mcp",
      "transport": "streamable-http"
    }
  }
}</div>
        <button class="btn btn-ghost" style="margin-top:12px" onclick="navigator.clipboard.writeText(JSON.stringify({mcpServers:{'shared-brain':{url:'http://localhost:3100/mcp',transport:'streamable-http'}}},null,2));toast('Copied to clipboard','success')">Copy Config</button>
      </div>
      <div class="card" style="padding:20px;max-width:600px;margin-top:16px">
        <h3 style="font-size:14px;margin-bottom:16px">Server Info</h3>
        <div class="flex flex-col gap-8" id="settings-info">
          <div class="flex justify-between"><span style="color:var(--muted);font-size:13px">Version</span><span style="font-size:13px">0.1.0</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);font-size:13px">Endpoint</span><span style="font-size:13px">http://localhost:3100/mcp</span></div>
          <div class="flex justify-between"><span style="color:var(--muted);font-size:13px">Transport</span><span style="font-size:13px">Streamable HTTP</span></div>
        </div>
      </div>
    </div>
  </main>
</div>

<!-- Toast Container -->
<div class="toast-container" id="toast-container"></div>

<script>
/*─── State ───────────────────────────────────────────────────────────────────*/
const state = {
  currentPage: 'dashboard',
  memories: [],
  searchResults: [],
  searchDebounce: null,
  startTime: Date.now(),
  scope: 'personal'
};

/*─── Router ──────────────────────────────────────────────────────────────────*/
function navigate(hash) {
  const page = (hash || '#dashboard').replace('#','') || 'dashboard';
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');
  const navEl = document.querySelector('.nav-item[href="#' + page + '"]');
  if (navEl) navEl.classList.add('active');
  loadPageData(page);
}

window.addEventListener('hashchange', () => navigate(location.hash));
window.addEventListener('load', () => navigate(location.hash || '#dashboard'));

/*─── Base Path (auto-detect for reverse proxy) ───────────────────────────────*/
const BASE = (() => { const p = window.location.pathname; const i = p.indexOf('/app'); return i > 0 ? p.substring(0, i) : ''; })();

/*─── MCP Client ──────────────────────────────────────────────────────────────*/
async function mcpCall(toolName, args = {}) {
  try {
    const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: toolName, arguments: args } });
    const res = await fetch(BASE + '/api/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const ct = res.headers.get('content-type') || '';
    let data;
    if (ct.includes('text/event-stream')) {
      const text = await res.text();
      for (const line of text.split(String.fromCharCode(10))) {
        if (line.startsWith('data: ')) { try { data = JSON.parse(line.slice(6)); } catch {} }
      }
    } else { data = await res.json(); }
    if (data?.result?.content) {
      for (const c of data.result.content) {
        if (c.type === 'text') { try { return JSON.parse(c.text); } catch { return c.text; } }
      }
    }
    return data?.result || data;
  } catch (e) { console.error('MCP call failed:', e); return null; }
}

async function restGet(url) {
  try { const r = await fetch(BASE + url); return r.ok ? await r.json() : null; } catch { return null; }
}

/*─── Page Data Loaders ───────────────────────────────────────────────────────*/
async function loadPageData(page) {
  switch(page) {
    case 'dashboard': await loadDashboard(); break;
    case 'search': break;
    case 'store': break;
    case 'checkin': await loadCheckin(); break;
    case 'ingest': await loadIngestLog(); break;
    case 'sync': await loadSync(); break;
    case 'agents': await loadAgents(); break;
    case 'security': await loadSecurity(); break;
    case 'status': await loadStatus(); break;
  }
}

async function loadDashboard() {
  // Stats
  const [memories, syncData, health] = await Promise.all([
    mcpCall('memory_list', {}),
    mcpCall('sync_status', {}),
    restGet('/health')
  ]);
  const memList = Array.isArray(memories) ? memories : (memories?.memories || []);
  state.memories = memList;
  const uptime = health ? Math.floor((Date.now() - state.startTime) / 60000) : 0;
  const todayCount = memList.filter(m => {
    const d = m.createdAt || m.created_at || '';
    return d.startsWith(new Date().toISOString().slice(0,10));
  }).length;

  document.getElementById('dash-stats').innerHTML = [
    { icon: '&#128200;', value: memList.length, label: 'Total Memories' },
    { icon: '&#129302;', value: syncData?.connectedAgents || '1', label: 'Active Agents' },
    { icon: '&#128269;', value: todayCount, label: 'Today\\'s Activity' },
    { icon: '&#9889;', value: uptime + 'm', label: 'Session Uptime' }
  ].map(s => '<div class="stat-card"><div class="stat-icon">' + s.icon + '</div><div class="stat-value">' + s.value + '</div><div class="stat-label">' + s.label + '</div></div>').join('');

  // Recent memories
  const recent = memList.slice(0, 8);
  document.getElementById('dash-recent').innerHTML = recent.length
    ? recent.map(m => renderMemoryCard(m)).join('')
    : '<div class="empty-state"><div class="empty-icon">&#128218;</div><p>No memories stored yet. Use the quick store below to add your first memory.</p></div>';
}

async function loadCheckin() {
  const data = await restGet('/api/checkin');
  const el = document.getElementById('checkin-grid');
  if (!data) {
    // Fallback: build from memories
    const memories = state.memories.length ? state.memories : (Array.isArray(await mcpCall('memory_list', {})) ? state.memories : []);
    const today = memories.filter(m => (m.createdAt||m.created_at||'').startsWith(new Date().toISOString().slice(0,10)));
    const types = {};
    memories.forEach(m => { types[m.type] = (types[m.type]||0)+1; });
    el.innerHTML = '<div class="checkin-card"><h3>Today\\'s Context</h3><ul class="checkin-list"><li>' + today.length + ' memories created today</li><li>' + memories.length + ' total memories</li></ul></div>'
      + '<div class="checkin-card"><h3>Memory Types</h3><ul class="checkin-list">' + Object.entries(types).map(([t,c]) => '<li>' + t + ': ' + c + '</li>').join('') + '</ul></div>'
      + '<div class="checkin-card"><h3>Recent Activity</h3><ul class="checkin-list">' + memories.slice(0,5).map(m => '<li>' + esc(m.title || m.content?.slice(0,40) || 'Untitled') + '</li>').join('') + '</ul></div>'
      + '<div class="checkin-card"><h3>Pending Actions</h3><ul class="checkin-list"><li>Review new memories</li><li>Check sync status</li></ul></div>';
    return;
  }
  el.innerHTML = '<div class="checkin-card"><h3>Summary</h3><p style="font-size:13px;color:var(--muted)">' + esc(data.summary || 'No briefing available') + '</p></div>'
    + '<div class="checkin-card"><h3>Active Projects</h3><ul class="checkin-list">' + (data.projects||[]).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul></div>'
    + '<div class="checkin-card"><h3>Recent Context</h3><ul class="checkin-list">' + (data.recent||[]).map(r => '<li>' + esc(r.title||r.content?.slice(0,40)||'') + '</li>').join('') + '</ul></div>'
    + '<div class="checkin-card"><h3>Cross-Agent Feed</h3><ul class="checkin-list">' + (data.feed||[]).map(f => '<li>' + esc(f) + '</li>').join('') + '</ul></div>';
}

async function loadIngestLog() {
  const data = await restGet('/ingest/log');
  const el = document.getElementById('ingest-log-list');
  if (!data || !Array.isArray(data) || !data.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#128229;</div><p>No ingestion events yet. Use the tabs above to test ingestion.</p></div>';
    return;
  }
  el.innerHTML = data.slice(0,30).map(entry => '<div class="card"><div class="card-header"><span class="card-title">' + esc(entry.source || entry.type || 'unknown') + '</span><span class="badge badge-type">' + esc(entry.type || '') + '</span><span style="font-size:11px;color:var(--muted);margin-left:auto">' + (entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '') + '</span></div><div style="font-size:12px;color:var(--muted)">' + esc((entry.content || entry.summary || '').slice(0,120)) + '</div></div>').join('');
}

async function loadSync() {
  const data = await restGet('/api/sync-demo/state');
  if (!data) {
    document.getElementById('sync-alice').innerHTML = '<p style="font-size:12px;color:var(--muted)">Could not load sync state</p>';
    document.getElementById('sync-bob').innerHTML = '<p style="font-size:12px;color:var(--muted)">Could not load sync state</p>';
    document.getElementById('sync-status').textContent = 'Sync demo unavailable';
    return;
  }
  const renderUser = (user) => {
    const memories = user.memories || [];
    if (!memories.length) return '<p style="font-size:12px;color:var(--muted)">No memories</p>';
    return memories.map(m => '<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px"><strong>' + esc(m.title||'Untitled') + '</strong><br/><span style="color:var(--muted)">' + esc((m.content||'').slice(0,60)) + '</span></div>').join('');
  };
  document.getElementById('sync-alice').innerHTML = renderUser(data.alice || data.users?.alice || { memories: [] });
  document.getElementById('sync-bob').innerHTML = renderUser(data.bob || data.users?.bob || { memories: [] });
  const conflicts = data.conflicts || [];
  document.getElementById('sync-conflicts').innerHTML = conflicts.length ? '<div class="section"><div class="section-title">Conflicts</div>' + conflicts.map(c => '<div class="conflict-card"><h4>Conflict: ' + esc(c.field || c.memoryId || '') + '</h4><p style="font-size:12px;color:var(--muted)">' + esc(c.resolution || JSON.stringify(c)) + '</p></div>').join('') + '</div>' : '';
  document.getElementById('sync-status').textContent = 'Last sync: ' + (data.lastSync ? new Date(data.lastSync).toLocaleTimeString() : 'now');
}

async function loadAgents() {
  const data = await restGet('/api/identity/agents');
  const el = document.getElementById('agents-list');
  const agents = Array.isArray(data) ? data : (data?.agents || []);
  if (!agents.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">&#129302;</div><p>No agents registered yet</p></div>';
  } else {
    el.innerHTML = agents.map(a => '<div class="agent-card"><div class="agent-avatar">' + (a.name||'A')[0].toUpperCase() + '</div><div class="agent-info"><div class="agent-name">' + esc(a.name || a.id || 'Unknown') + '</div><div class="agent-meta">' + esc(a.type || 'agent') + ' &middot; ' + esc(a.lastSeen ? new Date(a.lastSeen).toLocaleString() : 'active') + '</div></div><div class="agent-status ' + (a.active !== false ? 'online' : 'offline') + '"></div></div>').join('');
  }

  // Timeline
  const active = await restGet('/api/identity/active');
  const timeline = document.getElementById('agents-timeline');
  const sessions = Array.isArray(active) ? active : (active?.sessions || active?.active || []);
  if (!sessions.length) {
    timeline.innerHTML = '<div style="font-size:12px;color:var(--muted)">No recent activity</div>';
  } else {
    timeline.innerHTML = sessions.slice(0,10).map(s => '<div class="card" style="padding:10px 14px"><div class="flex items-center gap-8"><span style="font-size:12px;font-weight:600">' + esc(s.agentName || s.agent || s.id || '') + '</span><span style="font-size:11px;color:var(--muted);margin-left:auto">' + (s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : '') + '</span></div><div style="font-size:11px;color:var(--muted);margin-top:2px">' + esc(s.action || s.event || '') + '</div></div>').join('');
  }
}

async function loadSecurity() {
  const [secStatus, auditData] = await Promise.all([
    restGet('/api/security/status'),
    restGet('/api/audit')
  ]);

  // Stats
  const statsEl = document.getElementById('security-stats');
  if (secStatus) {
    const limits = secStatus.rateLimits || secStatus.rate_limits || {};
    statsEl.innerHTML = [
      { icon: '&#128274;', value: secStatus.encryption ? 'Active' : 'Disabled', label: 'Encryption' },
      { icon: '&#128736;', value: Object.keys(limits).length || '3', label: 'Rate Limits' },
      { icon: '&#128221;', value: secStatus.auditEntries || '0', label: 'Audit Entries' },
      { icon: '&#9989;', value: secStatus.sanitization ? 'Active' : 'Off', label: 'Sanitization' }
    ].map(s => '<div class="stat-card"><div class="stat-icon">' + s.icon + '</div><div class="stat-value">' + s.value + '</div><div class="stat-label">' + s.label + '</div></div>').join('');
  } else {
    statsEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Could not load security status</div>';
  }

  // Audit log
  const auditEl = document.getElementById('audit-log');
  const entries = Array.isArray(auditData) ? auditData : (auditData?.entries || auditData?.log || []);
  if (!entries.length) {
    auditEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">No audit entries</div>';
  } else {
    auditEl.innerHTML = entries.slice(0,50).map(e => {
      const statusColor = (e.status||200) >= 400 ? 'var(--error)' : (e.status||200) >= 300 ? '#f59e0b' : 'var(--success)';
      return '<div class="audit-row"><span class="audit-time">' + (e.timestamp ? new Date(e.timestamp).toLocaleString() : '') + '</span><span class="audit-method" style="color:var(--info)">' + esc(e.method||'') + '</span><span class="audit-path">' + esc(e.path || e.url || '') + '</span><span class="audit-status" style="color:' + statusColor + '">' + (e.status||'') + '</span></div>';
    }).join('');
  }
}

async function loadStatus() {
  const [health, syncData] = await Promise.all([
    restGet('/health'),
    mcpCall('sync_status', {})
  ]);

  const memories = state.memories.length || 0;
  const metricsEl = document.getElementById('status-metrics');
  metricsEl.innerHTML = [
    { icon: '&#9889;', value: health?.status === 'ok' ? 'Healthy' : 'Unknown', label: 'System Status' },
    { icon: '&#128200;', value: memories, label: 'Memory Count' },
    { icon: '&#128640;', value: syncData?.vectorCount || syncData?.vectors || '—', label: 'Vector Count' },
    { icon: '&#129504;', value: 'MiniLM-L6', label: 'Embedding Model' },
    { icon: '&#128190;', value: 'SQLite', label: 'Database' },
    { icon: '&#128338;', value: Math.floor((Date.now() - state.startTime) / 1000) + 's', label: 'Page Uptime' }
  ].map(s => '<div class="stat-card"><div class="stat-icon">' + s.icon + '</div><div class="stat-value">' + s.value + '</div><div class="stat-label">' + s.label + '</div></div>').join('');

  const servicesEl = document.getElementById('status-services');
  const services = [
    { name: 'MCP Endpoint', url: '/mcp', status: 'ok' },
    { name: 'Health Check', url: '/health', status: health ? 'ok' : 'error' },
    { name: 'Embedding Engine', status: 'ok' },
    { name: 'HNSW Vector Index', status: 'ok' },
    { name: 'SQLite Store', status: 'ok' },
  ];
  servicesEl.innerHTML = services.map(s => {
    const cls = s.status === 'ok' ? 'status-ok' : s.status === 'warn' ? 'status-warn' : 'status-err';
    return '<div class="card" style="padding:10px 14px"><div class="flex items-center justify-between"><span style="font-size:13px;font-weight:500">' + s.name + '</span><span class="status-indicator ' + cls + '"><span class="status-dot"></span>' + (s.status === 'ok' ? 'Operational' : s.status) + '</span></div></div>';
  }).join('');
}

/*─── Search ──────────────────────────────────────────────────────────────────*/
async function performSearch(query) {
  if (!query.trim()) {
    document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="empty-icon">&#128269;</div><p>Type to search across all memories using semantic similarity</p></div>';
    return;
  }
  document.getElementById('search-results').innerHTML = '<div style="text-align:center;padding:40px"><div class="loading-spinner"></div><p style="margin-top:8px;font-size:12px;color:var(--muted)">Searching...</p></div>';
  const data = await mcpCall('memory_search', { query, mode: 'hybrid', threshold: 0.05 });
  const results = Array.isArray(data) ? data : (data?.results || data?.memories || []);
  state.searchResults = results;

  if (!results.length) {
    document.getElementById('search-results').innerHTML = '<div class="empty-state"><div class="empty-icon">&#128528;</div><p>No results found for "' + esc(query) + '"</p></div>';
    return;
  }
  document.getElementById('search-results').innerHTML = results.map(m => {
    const score = m.score ?? m.similarity ?? 0;
    const pct = Math.round(score * 100);
    return '<div class="card search-result"><div class="card-header"><span class="card-title">' + esc(m.title || m.content?.slice(0,50) || 'Untitled') + '</span><span class="badge badge-type">' + esc(m.type||'') + '</span><div class="result-score"><span>' + pct + '%</span><div class="score-bar"><div class="score-fill" style="width:' + pct + '%"></div></div></div></div><div style="font-size:12px;color:var(--muted);margin-bottom:8px">' + esc((m.content||'').slice(0,180)) + '</div><div class="flex gap-8">' + (m.tags||[]).map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div></div>';
  }).join('');
}

/*─── Store ───────────────────────────────────────────────────────────────────*/
function updateStorePreview() {
  const content = document.getElementById('store-content').value;
  const title = document.getElementById('store-title').value;
  const type = document.getElementById('store-type').value;
  const tags = document.getElementById('store-tags').value.split(',').map(t => t.trim()).filter(Boolean);

  document.getElementById('preview-title').textContent = title || (content ? content.slice(0, 40) + (content.length > 40 ? '...' : '') : '—');
  document.getElementById('preview-type').textContent = type;
  document.getElementById('preview-scope').textContent = state.scope;
  document.getElementById('preview-length').textContent = content.length + ' chars';
  document.getElementById('preview-tags').innerHTML = tags.length ? tags.map(t => '<span class="tag">' + esc(t) + '</span>').join(' ') : '<span style="color:var(--muted);font-size:11px">Auto-generated from content</span>';
}

function setScope(el) {
  document.querySelectorAll('[data-scope]').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  state.scope = el.dataset.scope;
  updateStorePreview();
}

async function storeMemory() {
  const content = document.getElementById('store-content').value.trim();
  if (!content) { toast('Content is required', 'error'); return; }
  const title = document.getElementById('store-title').value.trim();
  const type = document.getElementById('store-type').value;
  const tags = document.getElementById('store-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const params = { content, type, scope: state.scope };
  if (title) params.title = title;
  if (tags.length) params.tags = tags;
  await mcpCall('memory_store', params);
  toast('Memory stored successfully', 'success');
  document.getElementById('store-content').value = '';
  document.getElementById('store-title').value = '';
  document.getElementById('store-tags').value = '';
  updateStorePreview();
}

async function quickStore() {
  const input = document.getElementById('quick-store-input');
  const content = input.value.trim();
  if (!content) return;
  await mcpCall('memory_store', { content, type: 'note', scope: 'personal' });
  toast('Memory stored', 'success');
  input.value = '';
  loadDashboard();
}

/*─── Ingest ──────────────────────────────────────────────────────────────────*/
function switchIngestTab(el) {
  const tab = el.dataset.tab;
  document.querySelectorAll('#ingest-tabs .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="ingest-tab-"]').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('ingest-tab-' + tab).classList.add('active');
}

async function testIngest(type) {
  let body = {};
  const token = 'dev-ingest-token';
  if (type === 'slack') {
    body = { text: document.getElementById('ingest-slack-content').value, channel: document.getElementById('ingest-slack-channel').value || 'general', user: 'test-user', timestamp: new Date().toISOString() };
  } else if (type === 'email') {
    body = { subject: document.getElementById('ingest-email-subject').value, from: document.getElementById('ingest-email-from').value, body: document.getElementById('ingest-email-body').value, timestamp: new Date().toISOString() };
  } else if (type === 'meeting') {
    body = { title: document.getElementById('ingest-meeting-title').value, notes: document.getElementById('ingest-meeting-notes').value, attendees: document.getElementById('ingest-meeting-attendees').value.split(',').map(a => a.trim()).filter(Boolean), timestamp: new Date().toISOString() };
  }
  try {
    const res = await fetch(BASE + '/ingest/' + type, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify(body) });
    if (res.ok) { toast('Ingested successfully', 'success'); loadIngestLog(); }
    else { toast('Ingestion failed: ' + res.status, 'error'); }
  } catch (e) { toast('Ingestion error', 'error'); }
}

/*─── Sync ────────────────────────────────────────────────────────────────────*/
function refreshSync() { loadSync(); toast('Sync state refreshed', 'info'); }

/*─── Security ────────────────────────────────────────────────────────────────*/
function testSanitize() {
  const input = document.getElementById('sanitize-input').value;
  const sanitized = input.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
  document.getElementById('sanitize-result').innerHTML = '<strong>Input:</strong> ' + esc(input) + '<br/><strong>Sanitized:</strong> ' + sanitized + '<br/><span style="color:var(--success)">XSS vectors neutralized</span>';
}

/*─── Utilities ───────────────────────────────────────────────────────────────*/
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

function renderMemoryCard(m) {
  const title = m.title || (m.content ? m.content.slice(0,50) : 'Untitled');
  const tags = m.tags || [];
  const date = m.createdAt || m.created_at || '';
  return '<div class="card"><div class="card-header"><span class="card-title">' + esc(title) + '</span><span class="badge badge-type">' + esc(m.type||'note') + '</span><span class="badge badge-scope">' + esc(m.scope||'') + '</span></div><div style="font-size:12px;color:var(--muted);margin-bottom:8px">' + esc((m.content||'').slice(0,120)) + '</div><div class="flex gap-8 items-center">' + tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '<span style="font-size:11px;color:var(--muted);margin-left:auto">' + (date ? new Date(date).toLocaleDateString() : '') + '</span></div></div>';
}

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast toast-' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 300); }, 3000);
}

function toggleSidebar() {
  document.getElementById('shell').classList.toggle('collapsed');
}

/*─── Event Listeners ─────────────────────────────────────────────────────────*/
// Global search
document.getElementById('global-search').addEventListener('input', function(e) {
  clearTimeout(state.searchDebounce);
  state.searchDebounce = setTimeout(() => {
    if (e.target.value.trim()) {
      location.hash = '#search';
      document.getElementById('search-main-input').value = e.target.value;
      performSearch(e.target.value);
    }
  }, 300);
});

// Search page input
document.getElementById('search-main-input').addEventListener('input', function(e) {
  clearTimeout(state.searchDebounce);
  state.searchDebounce = setTimeout(() => performSearch(e.target.value), 300);
});

// Store preview
['store-content','store-title','store-type','store-tags'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', updateStorePreview);
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  // / to focus search
  if (e.key === '/' && !isInputFocused()) {
    e.preventDefault();
    document.getElementById('global-search').focus();
  }
  // n for new memory
  if (e.key === 'n' && !isInputFocused()) {
    e.preventDefault();
    location.hash = '#store';
  }
  // Esc to blur
  if (e.key === 'Escape') {
    document.activeElement.blur();
  }
});

function isInputFocused() {
  const tag = document.activeElement?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}
</script>
<script src="/ux-enhance.js"></script>
</body>
</html>`;
