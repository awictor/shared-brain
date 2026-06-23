/**
 * Onboarding Demo — Beautiful setup wizard at GET /setup
 *
 * Three-step flow:
 * 1. Welcome — name/email form
 * 2. Configure — auto-generated MCP config for Claude Code, Cursor, VS Code
 * 3. Connect — "You're ready!" with link to dashboard
 *
 * Dark theme (#232F3E bg, #FF6100 accents), progress bar, all inline.
 */

import type { Application, Request, Response } from 'express';
import type { Store, VectorIndex } from './mcp/handler.js';
import type { IdentityManager } from './identity.js';

interface OnboardingDemoDeps {
  store: Store;
  identityManager: IdentityManager;
  vectorIndex: VectorIndex;
}

export function registerOnboardingDemo(
  app: Application,
  deps: OnboardingDemoDeps,
): void {
  const { store, identityManager } = deps;

  // Override GET /setup with the rich wizard (takes precedence if registered after onboarding.ts)
  app.get('/setup', async (_req: Request, res: Response) => {
    try {
      const memoryCount = await store.countMemories();
      const agents = identityManager.getAllAgents();

      // Already configured? → dashboard
      if (memoryCount > 0 || agents.length > 0) {
        res.redirect('/ui');
        return;
      }
    } catch {
      // If count fails, show wizard anyway
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(SETUP_WIZARD_HTML);
  });
}

// ─── Full Setup Wizard HTML ──────────────────────────────────────────────────

const SETUP_WIZARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain — Setup</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#232F3E;
  --surface:#1e2d3d;
  --surface2:#2a3a4a;
  --border:#3a4a5a;
  --text:#F5F3EF;
  --muted:#a0aab4;
  --accent:#FF6100;
  --accent-dim:#cc4e00;
  --accent-glow:rgba(255,97,0,.15);
  --success:#10b981;
  --success-dim:#059669;
}
body{
  font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:var(--bg);
  color:var(--text);
  min-height:100vh;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  padding:24px;
  overflow-x:hidden;
}

/* Progress bar */
.progress{
  position:fixed;top:0;left:0;right:0;height:4px;background:var(--surface2);z-index:1000;
}
.progress-fill{
  height:100%;background:linear-gradient(90deg,var(--accent),#ff8c42);
  border-radius:0 2px 2px 0;
  transition:width .5s cubic-bezier(.4,0,.2,1);
}

/* Steps indicator */
.steps-indicator{
  display:flex;gap:24px;margin-bottom:40px;
}
.step-dot{
  display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);transition:color .3s;
}
.step-dot.active{color:var(--accent)}
.step-dot.done{color:var(--success)}
.step-dot::before{
  content:'';display:block;width:10px;height:10px;border-radius:50%;
  border:2px solid var(--muted);transition:all .3s;
}
.step-dot.active::before{border-color:var(--accent);background:var(--accent);box-shadow:0 0 12px var(--accent-glow)}
.step-dot.done::before{border-color:var(--success);background:var(--success)}

/* Card */
.wizard-card{
  background:var(--surface);
  border:1px solid var(--border);
  border-radius:16px;
  padding:48px;
  max-width:560px;
  width:100%;
  box-shadow:0 20px 60px rgba(0,0,0,.3);
  animation:fadeUp .4s ease-out;
}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}

.wizard-card h1{font-size:32px;font-weight:700;margin-bottom:8px;line-height:1.2}
.wizard-card h1 span{color:var(--accent)}
.wizard-card .subtitle{color:var(--muted);font-size:15px;margin-bottom:32px;line-height:1.5}

/* Logo */
.logo{
  width:64px;height:64px;margin-bottom:24px;
  background:linear-gradient(135deg,var(--accent),#ff8c42);
  border-radius:14px;
  display:flex;align-items:center;justify-content:center;
  font-size:28px;font-weight:800;color:#fff;
  box-shadow:0 8px 24px rgba(255,97,0,.25);
}

/* Form */
.form-group{margin-bottom:20px}
.form-group label{display:block;font-size:13px;color:var(--muted);margin-bottom:6px;font-weight:500}
.form-group input,.form-group select{
  width:100%;padding:12px 16px;
  background:var(--surface2);border:1px solid var(--border);border-radius:8px;
  color:var(--text);font-size:14px;
  transition:border-color .2s,box-shadow .2s;
}
.form-group input:focus,.form-group select:focus{
  border-color:var(--accent);outline:none;
  box-shadow:0 0 0 3px var(--accent-glow);
}
.form-group input::placeholder{color:var(--muted);opacity:.6}

/* Buttons */
.btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:14px 28px;border-radius:8px;font-size:15px;font-weight:600;
  cursor:pointer;border:none;transition:all .2s;width:100%;
}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-dim);transform:translateY(-1px);box-shadow:0 6px 20px rgba(255,97,0,.3)}
.btn-secondary{background:var(--surface2);color:var(--text);border:1px solid var(--border)}
.btn-secondary:hover{border-color:var(--accent);color:var(--accent)}
.btn-success{background:var(--success);color:#fff}
.btn-success:hover{background:var(--success-dim)}

/* Config block */
.config-block{
  background:#0d1117;border:1px solid var(--border);border-radius:8px;
  padding:16px;margin-bottom:16px;position:relative;overflow:hidden;
}
.config-block pre{
  font-family:'SF Mono',Consolas,monospace;font-size:12px;
  color:#e6edf3;line-height:1.6;white-space:pre-wrap;word-break:break-all;
  margin:0;
}
.config-label{
  font-size:11px;text-transform:uppercase;letter-spacing:.5px;
  color:var(--accent);font-weight:600;margin-bottom:8px;display:block;
}
.copy-btn{
  position:absolute;top:8px;right:8px;
  background:var(--surface2);border:1px solid var(--border);border-radius:4px;
  color:var(--muted);font-size:11px;padding:4px 8px;cursor:pointer;
  transition:all .2s;
}
.copy-btn:hover{color:var(--accent);border-color:var(--accent)}
.copy-btn.copied{color:var(--success);border-color:var(--success)}

/* Tabs */
.tabs{display:flex;gap:4px;margin-bottom:16px;background:var(--surface2);border-radius:8px;padding:4px}
.tab{
  flex:1;padding:8px 12px;font-size:13px;font-weight:500;
  text-align:center;border-radius:6px;cursor:pointer;
  color:var(--muted);transition:all .2s;border:none;background:none;
}
.tab.active{background:var(--surface);color:var(--text);box-shadow:0 1px 3px rgba(0,0,0,.2)}

/* Success */
.success-icon{
  width:80px;height:80px;margin:0 auto 24px;
  background:linear-gradient(135deg,var(--success),#34d399);
  border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:36px;
  box-shadow:0 8px 24px rgba(16,185,129,.25);
  animation:scaleIn .4s cubic-bezier(.175,.885,.32,1.275);
}
@keyframes scaleIn{from{transform:scale(0)}to{transform:scale(1)}}

/* Features */
.features{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:24px;margin-bottom:24px}
.feature{
  background:var(--surface2);border:1px solid var(--border);border-radius:8px;
  padding:12px;font-size:13px;color:var(--muted);
}
.feature strong{display:block;color:var(--text);margin-bottom:2px;font-size:12px}

/* Hidden */
.hidden{display:none!important}

/* Responsive */
@media(max-width:600px){
  .wizard-card{padding:32px 24px}
  .wizard-card h1{font-size:24px}
  .features{grid-template-columns:1fr}
  .steps-indicator{gap:12px}
}
</style>
</head>
<body>

<!-- Progress bar -->
<div class="progress"><div class="progress-fill" id="progress-fill" style="width:33%"></div></div>

<!-- Steps indicator -->
<div class="steps-indicator">
  <div class="step-dot active" id="dot-1">Welcome</div>
  <div class="step-dot" id="dot-2">Configure</div>
  <div class="step-dot" id="dot-3">Connect</div>
</div>

<!-- Step 1: Welcome -->
<div class="wizard-card" id="step-1">
  <div class="logo">SB</div>
  <h1>Welcome to Shared<span>Brain</span></h1>
  <p class="subtitle">
    Your personal memory server for AI agents. Store knowledge once, access it everywhere.
    Setup takes less than 30 seconds.
  </p>

  <div class="form-group">
    <label>Your Name *</label>
    <input type="text" id="input-name" placeholder="e.g. Alex" autofocus/>
  </div>
  <div class="form-group">
    <label>Email (optional)</label>
    <input type="email" id="input-email" placeholder="alex@example.com"/>
  </div>
  <div class="form-group">
    <label>Default Scope</label>
    <select id="input-scope">
      <option value="personal" selected>Personal (just me)</option>
      <option value="team">Team (shared with team)</option>
      <option value="org">Organization (company-wide)</option>
    </select>
  </div>

  <button class="btn btn-primary" onclick="submitStep1()">
    Continue
    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
  </button>

  <div class="features">
    <div class="feature"><strong>Zero Config</strong>Works out of the box</div>
    <div class="feature"><strong>Auto-Organize</strong>Tags and links itself</div>
    <div class="feature"><strong>Multi-Agent</strong>Share across tools</div>
    <div class="feature"><strong>Semantic Search</strong>Find by meaning</div>
  </div>
</div>

<!-- Step 2: Configure -->
<div class="wizard-card hidden" id="step-2">
  <h1>Connect Your <span>Tools</span></h1>
  <p class="subtitle">
    Copy the config below into your editor's MCP settings. SharedBrain will auto-detect
    when each tool connects — no further setup needed.
  </p>

  <div class="tabs">
    <button class="tab active" onclick="showTab('claude')">Claude Code</button>
    <button class="tab" onclick="showTab('cursor')">Cursor</button>
    <button class="tab" onclick="showTab('vscode')">VS Code</button>
  </div>

  <div class="config-block" id="config-claude">
    <span class="config-label">~/.claude/settings.json</span>
    <button class="copy-btn" onclick="copyConfig('claude')">Copy</button>
    <pre id="pre-claude"></pre>
  </div>
  <div class="config-block hidden" id="config-cursor">
    <span class="config-label">.cursor/mcp.json</span>
    <button class="copy-btn" onclick="copyConfig('cursor')">Copy</button>
    <pre id="pre-cursor"></pre>
  </div>
  <div class="config-block hidden" id="config-vscode">
    <span class="config-label">.vscode/settings.json</span>
    <button class="copy-btn" onclick="copyConfig('vscode')">Copy</button>
    <pre id="pre-vscode"></pre>
  </div>

  <div style="display:flex;gap:12px;margin-top:24px">
    <button class="btn btn-secondary" onclick="goStep(1)" style="flex:0 0 auto;width:auto;padding:14px 20px">Back</button>
    <button class="btn btn-primary" onclick="goStep(3)">
      I've added the config
      <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
  </div>
</div>

<!-- Step 3: Done -->
<div class="wizard-card hidden" id="step-3">
  <div class="success-icon">&#10003;</div>
  <h1 style="text-align:center">You're <span>Ready!</span></h1>
  <p class="subtitle" style="text-align:center">
    SharedBrain is running and waiting for your first memory.
    Every memory_store call will be automatically organized with titles, tags, and semantic links.
  </p>

  <div class="features">
    <div class="feature"><strong>Auto-Title</strong>Generates titles from content</div>
    <div class="feature"><strong>Auto-Tag</strong>Extracts relevant tags</div>
    <div class="feature"><strong>Auto-Link</strong>Finds related memories</div>
    <div class="feature"><strong>Auto-Type</strong>Classifies memory type</div>
  </div>

  <a href="/ui" class="btn btn-success" style="text-decoration:none;margin-bottom:12px">
    Open Dashboard
    <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
  </a>
  <a href="/status" class="btn btn-secondary" style="text-decoration:none">
    View Server Status
  </a>
</div>

<script>
let currentStep = 1;
let setupData = {};

function goStep(n) {
  document.getElementById('step-' + currentStep).classList.add('hidden');
  document.getElementById('step-' + n).classList.remove('hidden');

  // Update progress
  document.getElementById('progress-fill').style.width = (n * 33) + '%';

  // Update dots
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('dot-' + i);
    dot.classList.remove('active', 'done');
    if (i < n) dot.classList.add('done');
    else if (i === n) dot.classList.add('active');
  }

  currentStep = n;
}

async function submitStep1() {
  const name = document.getElementById('input-name').value.trim();
  if (!name) {
    document.getElementById('input-name').style.borderColor = '#ef4444';
    document.getElementById('input-name').focus();
    return;
  }

  const email = document.getElementById('input-email').value.trim();
  const scope = document.getElementById('input-scope').value;

  try {
    const res = await fetch('/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: email || undefined, defaultScope: scope }),
    });
    const data = await res.json();

    if (data.success) {
      setupData = data;
      populateConfigs(data.mcpConfig);
      goStep(2);
    } else {
      alert(data.error || 'Setup failed. Please try again.');
    }
  } catch (err) {
    alert('Connection error. Is the server running?');
  }
}

function populateConfigs(configs) {
  // Claude Code
  const claudeConfig = {
    mcpServers: {
      'shared-brain': configs['claude-code'].mcpServers['shared-brain']
    }
  };
  document.getElementById('pre-claude').textContent = JSON.stringify(claudeConfig, null, 2);

  // Cursor
  const cursorConfig = {
    mcpServers: {
      'shared-brain': configs.cursor.mcpServers['shared-brain']
    }
  };
  document.getElementById('pre-cursor').textContent = JSON.stringify(cursorConfig, null, 2);

  // VS Code
  const vscodeConfig = configs.vscode;
  document.getElementById('pre-vscode').textContent = JSON.stringify(vscodeConfig, null, 2);
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.config-block').forEach(b => b.classList.add('hidden'));

  event.target.classList.add('active');
  document.getElementById('config-' + name).classList.remove('hidden');
}

function copyConfig(name) {
  const pre = document.getElementById('pre-' + name);
  navigator.clipboard.writeText(pre.textContent).then(() => {
    const btn = pre.parentElement.querySelector('.copy-btn');
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}

// Enter key on name field
document.getElementById('input-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitStep1();
});
</script>
</body>
</html>`;
