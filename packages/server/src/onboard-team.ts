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
.time{background:#10b981;color:#fff;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}
.note{background:#2a3a4a;border-left:3px solid #FF6100;padding:12px 16px;margin-top:16px;border-radius:0 8px 8px 0;font-size:13px;color:#a0aab4}
.features{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px}
.feat{background:#2a3a4a;padding:12px;border-radius:8px;font-size:13px}
.feat strong{color:#FF6100}
a{color:#FF6100}
</style>
</head>
<body>
<div class="container">
  <h1>Join Shared<span>Brain</span></h1>
  <p class="subtitle">Connect your AI agent to the team's shared memory. <span class="time">~2 min setup</span></p>

  <div class="step">
    <span class="step-num">1</span>
    <h2>Add to your MCP config</h2>
    <p>Open <code>~/.claude/mcpServers.json</code> (or your project's <code>.claude.json</code>) and add:</p>
    <pre><code>{
  "shared-brain": {
    "command": "node",
    "args": ["C:\\\\Users\\\\YOUR_ALIAS\\\\shared-brain\\\\mcp-stdio-proxy.mjs"]
  }
}</code><button class="copy-btn" onclick="copyStep1()">Copy</button></pre>
    <div class="note">Replace <code>YOUR_ALIAS</code> with your Windows username. On Mac/Linux adjust the path.</div>
  </div>

  <div class="step">
    <span class="step-num">2</span>
    <h2>Download the proxy script</h2>
    <p>Save this file to <code>~/shared-brain/mcp-stdio-proxy.mjs</code>:</p>
    <pre><code>mkdir -p ~/shared-brain
curl -o ~/shared-brain/mcp-stdio-proxy.mjs \\
  https://agenticmarketing.sps.amazon.dev/brain/proxy.js</code><button class="copy-btn" onclick="copyStep2()">Copy</button></pre>
    <p style="margin-top:8px;font-size:13px;color:#8a9aaa">Or just copy from <a href="/proxy.js">this link</a> and save it locally.</p>
  </div>

  <div class="step">
    <span class="step-num">3</span>
    <h2>Restart Claude Code</h2>
    <p>Type <code>/exit</code> and relaunch. You'll see <code>shared-brain</code> tools appear. Try:</p>
    <pre><code>"Search the shared brain for team weekly targets"</code></pre>
    <p style="margin-top:8px;color:#8a9aaa;font-size:13px">Your agent now has 11 tools: store, search, checkin, update, delete, list, relate, import, export, sync_status, and memory_checkin.</p>
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
function copyStep1(){navigator.clipboard.writeText(JSON.stringify({"shared-brain":{"command":"node","args":["C:\\\\Users\\\\YOUR_ALIAS\\\\shared-brain\\\\mcp-stdio-proxy.mjs"]}},null,2));event.target.textContent='Copied!';setTimeout(()=>event.target.textContent='Copy',2000)}
function copyStep2(){navigator.clipboard.writeText("mkdir -p ~/shared-brain\\ncurl -o ~/shared-brain/mcp-stdio-proxy.mjs https://agenticmarketing.sps.amazon.dev/brain/proxy.js");event.target.textContent='Copied!';setTimeout(()=>event.target.textContent='Copy',2000)}
</script>
</body>
</html>`;
