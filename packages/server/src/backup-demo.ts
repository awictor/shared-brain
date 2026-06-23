import type { Application } from 'express';
import type { BackupManager } from './backup.js';

export function registerBackupDemo(app: Application, backupManager: BackupManager): void {
  // Backup API routes
  app.get('/api/backup/status', (_req, res) => {
    try {
      const status = backupManager.getStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to get backup status' });
    }
  });

  app.post('/api/backup/now', async (_req, res) => {
    try {
      const result = await backupManager.backup();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Backup failed' });
    }
  });

  app.get('/api/backup/list', async (_req, res) => {
    try {
      const backups = await backupManager.listBackups();
      res.json({ backups });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to list backups' });
    }
  });

  // Backup demo page
  app.get('/demo/backup', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SharedBrain — Backup Manager</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0d1117; color: #c9d1d9; padding: 40px 20px; }
    .container { max-width: 900px; margin: 0 auto; }
    h1 { font-size: 2em; margin-bottom: 10px; color: #58a6ff; }
    .subtitle { color: #8b949e; margin-bottom: 30px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 24px; margin-bottom: 20px; }
    .status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat { padding: 12px; background: #0d1117; border-radius: 6px; }
    .stat-label { font-size: 0.85em; color: #8b949e; margin-bottom: 4px; }
    .stat-value { font-size: 1.5em; font-weight: 600; color: #58a6ff; }
    .btn { display: inline-block; background: #238636; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; text-decoration: none; }
    .btn:hover { background: #2ea043; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .backup-list { margin-top: 20px; }
    .backup-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #0d1117; border-radius: 6px; margin-bottom: 8px; }
    .backup-date { font-weight: 600; color: #c9d1d9; }
    .backup-size { color: #8b949e; font-size: 0.9em; }
    .badge { display: inline-block; padding: 4px 8px; background: #238636; color: white; border-radius: 4px; font-size: 0.75em; font-weight: 600; margin-left: 12px; }
    .badge.disabled { background: #6e7681; }
    .loading { text-align: center; padding: 40px; color: #8b949e; }
    .error { background: #f85149; color: white; padding: 12px; border-radius: 6px; margin-bottom: 20px; }
    .success { background: #238636; color: white; padding: 12px; border-radius: 6px; margin-bottom: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🗄️ Backup Manager</h1>
    <p class="subtitle">Automatic daily database backups (local + S3)</p>

    <div id="message"></div>

    <div class="card">
      <div class="status-grid" id="status">
        <div class="stat">
          <div class="stat-label">Last Backup</div>
          <div class="stat-value" id="lastBackup">—</div>
        </div>
        <div class="stat">
          <div class="stat-label">Next Scheduled</div>
          <div class="stat-value" id="nextBackup">—</div>
        </div>
        <div class="stat">
          <div class="stat-label">Total Backups</div>
          <div class="stat-value" id="backupCount">—</div>
        </div>
        <div class="stat">
          <div class="stat-label">Total Size</div>
          <div class="stat-value" id="totalSize">—</div>
        </div>
      </div>

      <div>
        <span style="color: #8b949e;">S3 Backup:</span>
        <span id="s3Status" class="badge">—</span>
      </div>

      <div style="margin-top: 20px;">
        <button class="btn" id="backupNow" onclick="runBackup()">Backup Now</button>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 16px; color: #c9d1d9;">Recent Backups</h2>
      <div class="backup-list" id="backupList">
        <div class="loading">Loading backups...</div>
      </div>
    </div>
  </div>

  <script>
    async function loadStatus() {
      try {
        const resp = await fetch('/api/backup/status');
        const data = await resp.json();

        document.getElementById('lastBackup').textContent = data.lastBackup
          ? new Date(data.lastBackup).toLocaleString()
          : 'Never';
        document.getElementById('nextBackup').textContent = data.nextBackup === 'pending'
          ? 'Pending'
          : new Date(data.nextBackup).toLocaleString();
        document.getElementById('backupCount').textContent = data.backupCount;
        document.getElementById('totalSize').textContent = data.totalSize;

        const s3Badge = document.getElementById('s3Status');
        s3Badge.textContent = data.s3Enabled ? 'Enabled' : 'Disabled';
        s3Badge.className = data.s3Enabled ? 'badge' : 'badge disabled';
      } catch (err) {
        showMessage('Failed to load status: ' + err.message, 'error');
      }
    }

    async function loadBackups() {
      try {
        const resp = await fetch('/api/backup/list');
        const data = await resp.json();

        const list = document.getElementById('backupList');
        if (data.backups.length === 0) {
          list.innerHTML = '<div class="loading">No backups yet</div>';
          return;
        }

        list.innerHTML = data.backups.map(b => \`
          <div class="backup-item">
            <div>
              <span class="backup-date">\${b.filename}</span>
            </div>
            <div class="backup-size">\${formatSize(b.size)}</div>
          </div>
        \`).join('');
      } catch (err) {
        showMessage('Failed to load backups: ' + err.message, 'error');
      }
    }

    async function runBackup() {
      const btn = document.getElementById('backupNow');
      btn.disabled = true;
      btn.textContent = 'Running backup...';

      try {
        const resp = await fetch('/api/backup/now', { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
          showMessage('Backup completed successfully!', 'success');
          await loadStatus();
          await loadBackups();
        } else {
          showMessage('Backup failed: ' + data.error, 'error');
        }
      } catch (err) {
        showMessage('Backup failed: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Backup Now';
      }
    }

    function showMessage(text, type) {
      const msg = document.getElementById('message');
      msg.className = type;
      msg.textContent = text;
      setTimeout(() => msg.textContent = '', 5000);
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + 'B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + 'GB';
    }

    loadStatus();
    loadBackups();
    setInterval(loadStatus, 30000); // Refresh every 30s
  </script>
</body>
</html>`);
  });
}
