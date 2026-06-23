/**
 * Team onboarding page — shows teammates exactly how to connect.
 * GET /brain/join (on the public server)
 */

import type { Application, Request, Response } from 'express';

export function registerTeamOnboarding(app: Application): void {
  app.get('/join', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(ONBOARD_HTML);
  });
}

const ONBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Join SharedBrain — Team Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a2332;color:#F5F3EF;min-height:100vh;padding:40px 20px;line-height:1.6}
.container{max-width:720px;margin:0 auto}
h1{font-size:32px;margin-bottom:8px}
h1 span{color:#FF6100}
.subtitle{color:#8a9aaa;font-size:16px;margin-bottom:40px}
.step{background:#232F3E;border:1px solid #3a4a5a;border-radius:12px;padding:24px;margin-bottom:20px}
.step-num{display:inline-block;width:28px;height:28px;background:#FF6100;color:#fff;border-radius:50%;text-align:center;line-height:28px;font-weight:700;font-size:13px;margin-right:10px}
.step h2{display:inline;font-size:18px}
.step p{margin-top:12px;color:#a0aab4;font-size:14px}
pre{background:#1a2332;border:1px solid #3a4a5a;border-radius:8px;padding:16px;margin-top:12px;overflow-x:auto;font-size:13px;line-height:1.5;position:relative}
code{font-family:'Cascadia Code',Consolas,monospace}
.copy-btn{position:absolute;top:8px;right:8px;background:#FF6100;border:none;color:#fff;padding:4px 10px;border-radius:4px;font-size:11px;cursor:pointer}
.copy-btn:hover{background:#cc4e00}
.verify-btn{background:#10b981;border:none;color:#fff;padding:8px 16px;border-radius:6px;font-size:13px;cursor:pointer;font-weight:600;margin-top:12px}
.verify-btn:hover{background:#059669}
.verify-btn:disabled{background:#6b7280;cursor:not-allowed}
.verify-result{margin-top:12px;padding:12px;border-radius:6px;font-size:13px;display:none}
.verify-success{background:#065f46;border:1px solid #10b981;color:#d1fae5}
.verify-error{background:#7f1d1d;border:1px solid #ef4444;color:#fecaca}
.time{background:#10b981;color:#fff;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}
.note{background:#2a3a4a;border-left:3px solid #FF6100;padding:12px 16px;margin-top:16px;border-radius:0 8px 8px 0;font-size:13px;color:#a0aab4}
.features{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}
.feat{background:#2a3a4a;padding:12px;border-radius:8px;font-size:13px}
.feat strong{color:#FF6100}
.intro{background:#2a3a4a;border:1px solid #3a4a5a;border-radius:12px;padding:24px;margin-bottom:28px}
.intro h2{font-size:20px;margin-bottom:12px;color:#F5F3EF}
.intro p{color:#a0aab4;margin-bottom:8px}
.intro ul{list-style:none;margin-top:16px;display:grid;gap:8px}
.intro li{padding-left:24px;position:relative;color:#a0aab4;font-size:14px}
.intro li:before{content:"✓";position:absolute;left:0;color:#10b981;font-weight:700}
a{color:#FF6100}
.os-tabs{display:flex;gap:8px;margin-bottom:12px}
.os-tab{padding:6px 16px;background:#1a2332;border:1px solid #3a4a5a;border-radius:6px;cursor:pointer;font-size:13px;color:#8a9aaa;transition:all .2s}
.os-tab.active{background:#FF6100;border-color:#FF6100;color:#fff;font-weight:600}
.os-tab:hover{border-color:#FF6100}
.os-content{display:none}
.os-content.active{display:block}
</style>
</head>
<body>
<div class="container">
  <h1>Join Shared<span>Brain</span></h1>
  <p class="subtitle">Connect your AI agent to the team's shared memory. <span class="time">~2 min setup</span></p>

  <div class="intro">
    <h2>What is SharedBrain?</h2>
    <p>SharedBrain is a persistent, cross-agent memory layer that gives your AI agent access to shared team knowledge. Instead of starting every conversation from scratch, your agent can store and retrieve facts, decisions, procedures, and context that persist across sessions and team members.</p>
    <ul>
      <li>Semantic search across all team knowledge</li>
      <li>Automatic organization with smart tagging</li>
      <li>Real-time sync between multiple agents</li>
      <li>Morning briefings with team activity summaries</li>
    </ul>
  </div>

  <div class="step">
    <span class="step-num">1</span>
    <h2>Add to your MCP config</h2>
    <p>Open <code>~/.claude/mcpServers.json</code> (or your project's <code>.claude.json</code>) and add:</p>
    <div class="os-tabs">
      <div class="os-tab active" onclick="switchOS('windows')">Windows</div>
      <div class="os-tab" onclick="switchOS('mac')">Mac</div>
      <div class="os-tab" onclick="switchOS('linux')">Linux</div>
    </div>
    <div class="os-content active" id="os-windows">
      <pre><code>{
  "shared-brain": {
    "command": "node",
    "args": ["C:\\\\Users\\\\YOUR_USERNAME\\\\shared-brain\\\\mcp-stdio-proxy.mjs"]
  }
}</code><button class="copy-btn" onclick="copyConfig('windows')">Copy</button></pre>
      <div class="note">Replace <code>YOUR_USERNAME</code> with your Windows username (e.g., <code>awictor</code>).</div>
    </div>
    <div class="os-content" id="os-mac">
      <pre><code>{
  "shared-brain": {
    "command": "node",
    "args": ["/Users/YOUR_USERNAME/shared-brain/mcp-stdio-proxy.mjs"]
  }
}</code><button class="copy-btn" onclick="copyConfig('mac')">Copy</button></pre>
      <div class="note">Replace <code>YOUR_USERNAME</code> with your Mac username.</div>
    </div>
    <div class="os-content" id="os-linux">
      <pre><code>{
  "shared-brain": {
    "command": "node",
    "args": ["/home/YOUR_USERNAME/shared-brain/mcp-stdio-proxy.mjs"]
  }
}</code><button class="copy-btn" onclick="copyConfig('linux')">Copy</button></pre>
      <div class="note">Replace <code>YOUR_USERNAME</code> with your Linux username.</div>
    </div>
  </div>

  <div class="step">
    <span class="step-num">2</span>
    <h2>Download the proxy script</h2>
    <p>Run these commands in your terminal:</p>
    <div class="os-tabs">
      <div class="os-tab active" onclick="switchOSStep2('windows')">Windows</div>
      <div class="os-tab" onclick="switchOSStep2('mac')">Mac</div>
      <div class="os-tab" onclick="switchOSStep2('linux')">Linux</div>
    </div>
    <div class="os-content active" id="os-step2-windows">
      <pre><code>mkdir %USERPROFILE%\\shared-brain
curl -o %USERPROFILE%\\shared-brain\\mcp-stdio-proxy.mjs https://agenticmarketing.sps.amazon.dev/brain/proxy.js</code><button class="copy-btn" onclick="copyStep2('windows')">Copy</button></pre>
    </div>
    <div class="os-content" id="os-step2-mac">
      <pre><code>mkdir -p ~/shared-brain
curl -o ~/shared-brain/mcp-stdio-proxy.mjs https://agenticmarketing.sps.amazon.dev/brain/proxy.js</code><button class="copy-btn" onclick="copyStep2('mac')">Copy</button></pre>
    </div>
    <div class="os-content" id="os-step2-linux">
      <pre><code>mkdir -p ~/shared-brain
curl -o ~/shared-brain/mcp-stdio-proxy.mjs https://agenticmarketing.sps.amazon.dev/brain/proxy.js</code><button class="copy-btn" onclick="copyStep2('linux')">Copy</button></pre>
    </div>
    <p style="margin-top:8px;font-size:13px;color:#8a9aaa">Or download from <a href="/proxy.js">this link</a> and save it manually.</p>
  </div>

  <div class="step">
    <span class="step-num">3</span>
    <h2>Restart Claude Code</h2>
    <p>Type <code>/exit</code> and relaunch. You'll see <code>shared-brain</code> tools appear. Try:</p>
    <pre><code>"Search the shared brain for team weekly targets"</code></pre>
    <p style="margin-top:8px;color:#8a9aaa;font-size:13px">Your agent now has 11 tools: store, search, checkin, update, delete, list, relate, import, export, sync_status, and memory_checkin.</p>
  </div>

  <div class="step">
    <span class="step-num">4</span>
    <h2>Verify Connection</h2>
    <p>Click the button below to test if your proxy can reach the SharedBrain server:</p>
    <button class="verify-btn" onclick="verifyConnection()">Test Connection</button>
    <div class="verify-result" id="verify-result"></div>
  </div>

  <div class="step">
    <span class="step-num">✓</span>
    <h2>That's it!</h2>
    <p>Everything you store goes to the shared brain. Everything you search pulls from the team's collective knowledge.</p>
    <div class="features">
      <div class="feat"><strong>memory_store</strong> — Save facts, decisions, procedures</div>
      <div class="feat"><strong>memory_search</strong> — Semantic search across all team knowledge</div>
      <div class="feat"><strong>memory_checkin</strong> — Get a morning briefing of team activity</div>
      <div class="feat"><strong>Auto-organize</strong> — Title, tags, type inferred automatically</div>
    </div>
  </div>

  <div class="step" style="border-color:#FF6100">
    <h2 style="display:block;margin-bottom:8px">👁 View the Brain</h2>
    <p>Open <a href="/app" target="_blank">agenticmarketing.sps.amazon.dev/brain/app</a> to browse all team memories, search, and store from the web UI.</p>
  </div>
</div>
<script>
let currentOS = 'windows';
let currentOSStep2 = 'windows';

function detectOS() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'mac';
  if (platform.includes('linux')) return 'linux';
  return 'windows';
}

window.addEventListener('DOMContentLoaded', () => {
  const detected = detectOS();
  if (detected !== 'windows') {
    switchOS(detected);
    switchOSStep2(detected);
  }
});

function switchOS(os) {
  currentOS = os;
  document.querySelectorAll('.os-tabs .os-tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent.toLowerCase() === os);
  });
  document.querySelectorAll('.os-content').forEach(content => {
    const isTarget = content.id === 'os-' + os;
    content.classList.toggle('active', isTarget);
  });
}

function switchOSStep2(os) {
  currentOSStep2 = os;
  const tabs = document.querySelectorAll('.step:nth-of-type(3) .os-tab');
  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.textContent.toLowerCase() === os);
  });
  const contents = document.querySelectorAll('[id^="os-step2-"]');
  contents.forEach(content => {
    const isTarget = content.id === 'os-step2-' + os;
    content.classList.toggle('active', isTarget);
  });
}

function copyConfig(os) {
  let json;
  if (os === 'windows') {
    json = {"shared-brain":{"command":"node","args":["C:\\\\Users\\\\YOUR_USERNAME\\\\shared-brain\\\\mcp-stdio-proxy.mjs"]}};
  } else if (os === 'mac') {
    json = {"shared-brain":{"command":"node","args":["/Users/YOUR_USERNAME/shared-brain/mcp-stdio-proxy.mjs"]}};
  } else {
    json = {"shared-brain":{"command":"node","args":["/home/YOUR_USERNAME/shared-brain/mcp-stdio-proxy.mjs"]}};
  }
  navigator.clipboard.writeText(JSON.stringify(json, null, 2));
  event.target.textContent='Copied!';
  setTimeout(()=>event.target.textContent='Copy',2000);
}

function copyStep2(os) {
  let cmd;
  if (os === 'windows') {
    cmd = "mkdir %USERPROFILE%\\\\shared-brain\\ncurl -o %USERPROFILE%\\\\shared-brain\\\\mcp-stdio-proxy.mjs https://agenticmarketing.sps.amazon.dev/brain/proxy.js";
  } else {
    cmd = "mkdir -p ~/shared-brain\\ncurl -o ~/shared-brain/mcp-stdio-proxy.mjs https://agenticmarketing.sps.amazon.dev/brain/proxy.js";
  }
  navigator.clipboard.writeText(cmd);
  event.target.textContent='Copied!';
  setTimeout(()=>event.target.textContent='Copy',2000);
}

async function verifyConnection() {
  const btn = event.target;
  const result = document.getElementById('verify-result');
  btn.disabled = true;
  btn.textContent = 'Testing...';
  result.style.display = 'none';

  try {
    const response = await fetch('/health');
    if (response.ok) {
      const data = await response.json();
      result.className = 'verify-result verify-success';
      result.textContent = '✓ Connection successful! Server is running and accessible.';
      result.style.display = 'block';
    } else {
      throw new Error('Server returned ' + response.status);
    }
  } catch (error) {
    result.className = 'verify-result verify-error';
    result.textContent = '✗ Connection failed: ' + error.message + '. Make sure the proxy script is configured correctly and the server is reachable.';
    result.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}
</script>
</body>
</html>`;
