/**
 * UX Research Module — Analytics, Heuristic Evaluation, Usability Testing
 * Mounts at /research/* with in-memory storage
 */

// ─── In-memory analytics store ──────────────────────────────────────────────

interface AnalyticsEvent {
  type: string;
  page: string;
  element?: string;
  timestamp: string;
}

const events: AnalyticsEvent[] = [];
const MAX_EVENTS = 1000;

function addEvent(event: AnalyticsEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
}

function getSummary() {
  const sessions = new Set(events.map(e => e.timestamp.slice(0, 13))).size;
  const pageVisits = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'pageview') pageVisits.set(e.page, (pageVisits.get(e.page) ?? 0) + 1);
  }
  const topPages = [...pageVisits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([page, visits]) => ({ page, visits }));

  const durations: number[] = [];
  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  for (let i = 1; i < sorted.length; i++) {
    const diff = new Date(sorted[i].timestamp).getTime() - new Date(sorted[i - 1].timestamp).getTime();
    if (diff < 30 * 60 * 1000) durations.push(diff);
  }
  const avgDuration = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : 0;

  return { totalEvents: events.length, sessions, avgDurationSec: avgDuration, topPages };
}

// ─── Shared styles ──────────────────────────────────────────────────────────

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1a2332; color: #F5F3EF; font-family: Inter, system-ui, sans-serif; line-height: 1.6; padding: 2rem; }
  h1 { color: #FF6100; margin-bottom: 1.5rem; font-size: 1.75rem; }
  h2 { color: #FF6100; margin: 1.5rem 0 0.75rem; font-size: 1.25rem; }
  .card { background: #232F3E; border: 1px solid #3a4a5c; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; }
  .nav { display: flex; gap: 1rem; margin-bottom: 2rem; }
  .nav a { color: #FF6100; text-decoration: none; padding: 0.5rem 1rem; border: 1px solid #3a4a5c; border-radius: 4px; }
  .nav a:hover { background: #2a3a4e; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #3a4a5c; }
  th { color: #FF6100; font-size: 0.85rem; text-transform: uppercase; }
  .stat { display: inline-block; text-align: center; margin-right: 2rem; }
  .stat-value { font-size: 2rem; font-weight: 700; color: #FF6100; }
  .stat-label { font-size: 0.8rem; color: #8a9ab0; }
  .score-bar { height: 8px; background: #3a4a5c; border-radius: 4px; margin: 0.5rem 0; }
  .score-fill { height: 100%; background: #FF6100; border-radius: 4px; }
  .badge { display: inline-block; background: #FF6100; color: #1a2332; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.8rem; }
  button { background: #FF6100; color: #1a2332; border: none; padding: 0.6rem 1.2rem; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
  button:hover { background: #e55800; }
  button:disabled { background: #3a4a5c; color: #8a9ab0; cursor: not-allowed; }
  .timer { font-family: monospace; font-size: 1.5rem; color: #FF6100; }
  .task-done { opacity: 0.5; }
  .rating { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
  .rating button { padding: 0.4rem 0.8rem; background: #3a4a5c; color: #F5F3EF; }
  .rating button.active { background: #FF6100; color: #1a2332; }
`;

const NAV = `<div class="nav">
  <a href="/research/analytics">Analytics</a>
  <a href="/research/heuristics">Heuristics</a>
  <a href="/research/test">Usability Test</a>
</div>`;

// ─── Analytics page ─────────────────────────────────────────────────────────

function analyticsPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Analytics Dashboard</title>
<style>${CSS}</style></head><body>
${NAV}
<h1>Analytics Dashboard</h1>
<div id="stats"></div>
<h2>Recent Events</h2>
<div class="card"><table><thead><tr><th>Time</th><th>Type</th><th>Page</th><th>Element</th></tr></thead><tbody id="events"></tbody></table></div>
<script>
async function load() {
  const res = await fetch('/api/analytics/summary');
  const data = await res.json();
  document.getElementById('stats').innerHTML = \`
    <div class="card" style="display:flex;gap:2rem;flex-wrap:wrap;">
      <div class="stat"><div class="stat-value">\${data.totalEvents}</div><div class="stat-label">Total Events</div></div>
      <div class="stat"><div class="stat-value">\${data.sessions}</div><div class="stat-label">Sessions</div></div>
      <div class="stat"><div class="stat-value">\${data.avgDurationSec}s</div><div class="stat-label">Avg Duration</div></div>
    </div>
    <h2>Top Pages</h2>
    <div class="card"><table><thead><tr><th>Page</th><th>Visits</th></tr></thead><tbody>
      \${data.topPages.map(p => \`<tr><td>\${p.page}</td><td>\${p.visits}</td></tr>\`).join('')}
    </tbody></table></div>\`;

  const evRes = await fetch('/api/analytics/events');
  const evts = await evRes.json();
  document.getElementById('events').innerHTML = evts.slice(-50).reverse()
    .map(e => \`<tr><td>\${new Date(e.timestamp).toLocaleTimeString()}</td><td>\${e.type}</td><td>\${e.page}</td><td>\${e.element||'-'}</td></tr>\`).join('');
}
load(); setInterval(load, 5000);
</script></body></html>`;
}

// ─── Heuristics page ────────────────────────────────────────────────────────

interface Heuristic {
  name: string;
  score: number;
  description: string;
  issue: string;
  recommendation: string;
}

const heuristics: Heuristic[] = [
  { name: 'System Status', score: 4, description: 'System visibility of status for all operations', issue: 'No loading indicators during memory storage or search operations', recommendation: 'Add skeleton loaders and progress indicators for async operations' },
  { name: 'Real-world Match', score: 5, description: 'Language matches user mental models', issue: 'Terminology is clear and intuitive throughout the interface', recommendation: 'Maintain current approach; consider user testing for new features' },
  { name: 'User Control & Freedom', score: 3, description: 'Easy undo and escape from unwanted states', issue: 'No undo after deleting a memory; no confirmation dialog', recommendation: 'Add soft-delete with 30s undo toast; add confirmation for destructive actions' },
  { name: 'Consistency & Standards', score: 3, description: 'Follows platform conventions consistently', issue: 'Multiple UI paradigms across demo pages vs main app', recommendation: 'Unify all interfaces under the SPA; consistent component library' },
  { name: 'Error Prevention', score: 4, description: 'Prevents errors before they occur', issue: 'Users can store empty content without validation', recommendation: 'Add client-side validation; minimum content length; required fields' },
  { name: 'Recognition over Recall', score: 4, description: 'Minimize memory load with visible options', issue: 'Tags must be typed from memory; no autocomplete suggestions', recommendation: 'Add tag autocomplete from existing tags; show recent/popular tags' },
  { name: 'Flexibility & Efficiency', score: 4, description: 'Accelerators for expert users', issue: 'Keyboard shortcuts exist but are not discoverable', recommendation: 'Add keyboard shortcut overlay (Ctrl+?); show hints in tooltips' },
  { name: 'Aesthetic & Minimal Design', score: 4, description: 'No irrelevant or rarely needed information', issue: 'Interface is clean but could benefit from better information hierarchy', recommendation: 'Add progressive disclosure for advanced options; collapsible sections' },
  { name: 'Error Recovery', score: 3, description: 'Help users recognize and recover from errors', issue: 'Generic error messages without actionable guidance', recommendation: 'Show specific error messages with recovery steps; link to docs' },
  { name: 'Help & Documentation', score: 2, description: 'Accessible help and documentation', issue: 'No in-app help, tooltips, or onboarding guide', recommendation: 'Add contextual help tooltips; first-run onboarding wizard; help page' },
];

function heuristicsPage(): string {
  const total = heuristics.reduce((s, h) => s + h.score, 0);
  const rows = heuristics.map((h, i) => `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong>${i + 1}. ${h.name}</strong>
        <span class="badge">${h.score}/5</span>
      </div>
      <div class="score-bar"><div class="score-fill" style="width:${h.score * 20}%"></div></div>
      <p style="color:#8a9ab0;font-size:0.85rem;margin:0.5rem 0">${h.description}</p>
      <p><strong style="color:#e55800;">Issue:</strong> ${h.issue}</p>
      <p><strong style="color:#4caf50;">Recommendation:</strong> ${h.recommendation}</p>
    </div>`).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Heuristic Evaluation</title>
<style>${CSS}</style></head><body>
${NAV}
<h1>Heuristic Evaluation — Nielsen's 10 Usability Heuristics</h1>
<div class="card" style="display:flex;gap:2rem;align-items:center;margin-bottom:1.5rem;">
  <div class="stat"><div class="stat-value">${total}/50</div><div class="stat-label">Overall Score</div></div>
  <div style="flex:1"><div class="score-bar" style="height:12px"><div class="score-fill" style="width:${total * 2}%;height:100%"></div></div></div>
</div>
${rows}
</body></html>`;
}

// ─── Usability test page ────────────────────────────────────────────────────

function testPage(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Usability Test</title>
<style>${CSS}
.task { transition: opacity 0.3s; }
.results { display: none; }
.results.visible { display: block; }
.sus-q { margin: 1rem 0; }
</style></head><body>
${NAV}
<h1>Usability Test — 5 Tasks</h1>
<div id="tasks"></div>
<div id="results" class="results"></div>
<script>
const tasks = [
  { id: 1, instruction: "Store a memory about your next meeting" },
  { id: 2, instruction: "Search for something you stored earlier" },
  { id: 3, instruction: "Check your morning briefing" },
  { id: 4, instruction: "Send a test Slack message via ingestion" },
  { id: 5, instruction: "Find memories related to another memory" },
];

let currentTask = 0;
let timers = [];
let intervals = [];
let results = [];

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? m + 'm ' + (s % 60) + 's' : s + 's';
}

function renderTasks() {
  const el = document.getElementById('tasks');
  el.innerHTML = tasks.map((t, i) => {
    const done = i < currentTask;
    const active = i === currentTask;
    return \`<div class="card task \${done ? 'task-done' : ''}" id="task-\${i}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div><strong>Task \${t.id}:</strong> \${t.instruction}</div>
        <div style="display:flex;align-items:center;gap:1rem;">
          <span class="timer" id="timer-\${i}">\${done ? formatTime(results[i]) : '0s'}</span>
          \${active ? '<button onclick="completeTask()">Complete</button>' : ''}
          \${done ? '<span style="color:#4caf50;">Done</span>' : ''}
        </div>
      </div>
    </div>\`;
  }).join('');

  if (currentTask < tasks.length) startTimer(currentTask);
}

function startTimer(idx) {
  timers[idx] = Date.now();
  intervals[idx] = setInterval(() => {
    const el = document.getElementById('timer-' + idx);
    if (el) el.textContent = formatTime(Date.now() - timers[idx]);
  }, 100);
}

function completeTask() {
  clearInterval(intervals[currentTask]);
  results[currentTask] = Date.now() - timers[currentTask];
  currentTask++;
  if (currentTask >= tasks.length) showResults();
  else renderTasks();
}

function showResults() {
  renderTasks();
  const total = results.reduce((a, b) => a + b, 0);
  const el = document.getElementById('results');
  el.className = 'results visible';
  el.innerHTML = \`
    <h2>Results Summary</h2>
    <div class="card">
      <table><thead><tr><th>Task</th><th>Time</th></tr></thead><tbody>
        \${tasks.map((t, i) => \`<tr><td>\${t.instruction}</td><td>\${formatTime(results[i])}</td></tr>\`).join('')}
        <tr style="font-weight:700"><td>Total</td><td>\${formatTime(total)}</td></tr>
      </tbody></table>
    </div>
    <h2>System Usability Scale (SUS)</h2>
    <div class="card">
      <div class="sus-q"><p>1. I found the system easy to use</p><div class="rating" data-q="1">\${ratingBtns(1)}</div></div>
      <div class="sus-q"><p>2. I would use this system frequently</p><div class="rating" data-q="2">\${ratingBtns(2)}</div></div>
      <div class="sus-q"><p>3. I felt confident using the system</p><div class="rating" data-q="3">\${ratingBtns(3)}</div></div>
      <button onclick="submitSUS()" style="margin-top:1rem">Submit Feedback</button>
      <div id="sus-result" style="margin-top:0.75rem;color:#4caf50;"></div>
    </div>\`;
}

function ratingBtns(q) {
  return [1,2,3,4,5].map(n => \`<button onclick="rate(\${q},\${n},this)">\${n}</button>\`).join('');
}

const susScores = {};
function rate(q, n, btn) {
  susScores[q] = n;
  btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function submitSUS() {
  const avg = Object.values(susScores).reduce((a,b) => a+b, 0) / Object.keys(susScores).length || 0;
  await fetch('/api/analytics/event', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ type:'usability_test', page:'/research/test', element:'sus_score:'+avg.toFixed(1), timestamp: new Date().toISOString() })
  });
  document.getElementById('sus-result').textContent = 'Submitted. Average SUS score: ' + avg.toFixed(1) + '/5';
}

renderTasks();
</script></body></html>`;
}

// ─── Register routes ────────────────────────────────────────────────────────

export function registerUXResearch(app: any): void {
  // Pages
  app.get('/research/analytics', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(analyticsPage());
  });

  app.get('/research/heuristics', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(heuristicsPage());
  });

  app.get('/research/test', (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(testPage());
  });

  // API
  app.post('/api/analytics/event', (req: any, res: any) => {
    const { type, page, element, timestamp } = req.body ?? {};
    if (!type || !page) return res.status(400).json({ error: 'type and page required' });
    addEvent({ type, page, element, timestamp: timestamp || new Date().toISOString() });
    res.json({ ok: true });
  });

  app.get('/api/analytics/summary', (_req: any, res: any) => {
    res.json(getSummary());
  });

  app.get('/api/analytics/events', (_req: any, res: any) => {
    res.json(events.slice(-50));
  });
}
