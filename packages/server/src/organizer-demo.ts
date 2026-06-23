/**
 * Organizer Demo — GET /demo/organizer endpoint showing auto-organization in action.
 */

import type { Application, Request, Response } from 'express';
import type { Organizer } from './organizer.js';

export function registerOrganizerDemo(app: Application, organizer: Organizer): void {
  app.get('/demo/organizer', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(DEMO_HTML);
  });

  app.post('/api/organize', async (req: Request, res: Response) => {
    try {
      const { content, title, type, tags, scope } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required' });
        return;
      }
      const result = await organizer.organize(
        content,
        title || undefined,
        type || undefined,
        tags?.length ? tags : undefined,
        scope || undefined,
      );
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });
}

const DEMO_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>SharedBrain Organizer Demo</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#232F3E;--surface:#2a3a4a;--border:#3a4a5a;--text:#F5F3EF;--muted:#a0aab4;--accent:#FF6100;--accent-dim:#cc4e00;--success:#10b981;--card:#1e2d3d}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;line-height:1.6;padding:40px 20px}
.container{max-width:900px;margin:0 auto}
h1{font-size:28px;font-weight:700;margin-bottom:8px}
h1 span{color:var(--accent)}
.subtitle{color:var(--muted);font-size:14px;margin-bottom:32px}
textarea{width:100%;min-height:160px;resize:vertical;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;font-size:15px;color:var(--text);outline:none;transition:border-color .2s}
textarea:focus{border-color:var(--accent)}
textarea::placeholder{color:var(--muted)}
.btn{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:12px 28px;background:var(--accent);border:none;border-radius:8px;color:#fff;font-size:15px;font-weight:600;cursor:pointer;transition:background .2s,transform .1s}
.btn:hover{background:var(--accent-dim)}
.btn:active{transform:scale(.98)}
.btn:disabled{opacity:.5;cursor:not-allowed}
.results{margin-top:32px;display:none}
.results.visible{display:block}
.result-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:600px){.result-grid{grid-template-columns:1fr}}
.result-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:20px}
.result-card h3{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:8px}
.result-card .value{font-size:16px;font-weight:500;word-break:break-word}
.result-card.full{grid-column:1/-1}
.badge{display:inline-block;font-size:12px;padding:4px 10px;border-radius:14px;font-weight:500;margin:3px 4px 3px 0}
.badge-type{background:#1e3a5f;color:#60a5fa}
.badge-scope{background:#1e3f2e;color:#6ee7b7}
.badge-tag{background:var(--surface);border:1px solid var(--border);color:var(--muted)}
.relation{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px}
.relation:last-child{border-bottom:none}
.relation-type{font-size:11px;text-transform:uppercase;padding:2px 6px;border-radius:4px;font-weight:600}
.relation-type.relates_to{background:#1e3a5f;color:#60a5fa}
.relation-type.supersedes{background:#3f1e1e;color:#f87171}
.relation-type.contradicts{background:#3f2e1e;color:#fbbf24}
.relation-id{color:var(--muted);font-family:monospace;font-size:12px}
.empty-rel{color:var(--muted);font-size:13px;font-style:italic}
.examples{margin-top:40px;padding-top:24px;border-top:1px solid var(--border)}
.examples h2{font-size:16px;color:var(--muted);margin-bottom:12px}
.example-chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:8px 14px;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text);cursor:pointer;transition:border-color .2s}
.chip:hover{border-color:var(--accent)}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="container">
  <h1>Shared<span>Brain</span> Organizer</h1>
  <p class="subtitle">Paste any memory content below. The organizer will auto-classify type, generate a title, extract tags, assign scope, and find related memories — all locally, no external APIs.</p>

  <textarea id="input" placeholder="Paste memory content here...&#10;&#10;Examples:&#10;- \\"We decided to use PostgreSQL instead of MongoDB for the user service\\"&#10;- \\"To deploy to staging, first run brazil-build, then push to pipelines\\"&#10;- \\"I prefer dark theme with orange accents for all dashboards\\""></textarea>

  <button class="btn" id="organize-btn" onclick="organize()">
    <span id="btn-text">Organize</span>
  </button>

  <div class="results" id="results">
    <div class="result-grid">
      <div class="result-card">
        <h3>Type</h3>
        <div class="value"><span class="badge badge-type" id="r-type"></span></div>
      </div>
      <div class="result-card">
        <h3>Scope</h3>
        <div class="value"><span class="badge badge-scope" id="r-scope"></span></div>
      </div>
      <div class="result-card full">
        <h3>Title</h3>
        <div class="value" id="r-title"></div>
      </div>
      <div class="result-card full">
        <h3>Tags</h3>
        <div class="value" id="r-tags"></div>
      </div>
      <div class="result-card full">
        <h3>Relations</h3>
        <div class="value" id="r-relations"></div>
      </div>
    </div>
  </div>

  <div class="examples">
    <h2>Try these examples:</h2>
    <div class="example-chips">
      <div class="chip" onclick="tryExample(this)">We decided to use FastAPI instead of Flask for the new microservice because of async support.</div>
      <div class="chip" onclick="tryExample(this)">To deploy to production, first run tests, then create a CR, get approval, and push to pipelines.</div>
      <div class="chip" onclick="tryExample(this)">I prefer using TypeScript over JavaScript for all new projects. Always enable strict mode.</div>
      <div class="chip" onclick="tryExample(this)">See also: https://docs.hub.amazon.dev/brazil/ for build system documentation.</div>
      <div class="chip" onclick="tryExample(this)">Our team agreed that all PRs need at least two approvals before merging to the main branch.</div>
      <div class="chip" onclick="tryExample(this)">The company requires all employees to complete security training by end of Q4.</div>
    </div>
  </div>
</div>

<script>
function tryExample(el) {
  document.getElementById('input').value = el.textContent;
  organize();
}

async function organize() {
  const content = document.getElementById('input').value.trim();
  if (!content) return;

  const btn = document.getElementById('organize-btn');
  const btnText = document.getElementById('btn-text');
  btn.disabled = true;
  btnText.innerHTML = '<span class="spinner"></span> Organizing...';

  try {
    const res = await fetch('/api/organize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();

    if (data.error) {
      alert('Error: ' + data.error);
      return;
    }

    document.getElementById('r-type').textContent = data.type;
    document.getElementById('r-scope').textContent = data.scope;
    document.getElementById('r-title').textContent = data.title;

    const tagsEl = document.getElementById('r-tags');
    if (data.tags.length) {
      tagsEl.innerHTML = data.tags.map(t => '<span class="badge badge-tag">' + esc(t) + '</span>').join('');
    } else {
      tagsEl.innerHTML = '<span style="color:var(--muted);font-style:italic">No tags extracted</span>';
    }

    const relEl = document.getElementById('r-relations');
    if (data.relations.length) {
      relEl.innerHTML = data.relations.map(r =>
        '<div class="relation"><span class="relation-type ' + esc(r.type) + '">' + esc(r.type) + '</span><span class="relation-id">' + esc(r.targetId) + '</span></div>'
      ).join('');
    } else {
      relEl.innerHTML = '<span class="empty-rel">No related memories found (index may be empty)</span>';
    }

    document.getElementById('results').classList.add('visible');
  } catch (err) {
    alert('Request failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Organize';
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Allow Ctrl+Enter to submit
document.getElementById('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) organize();
});
</script>
</body>
</html>`;
