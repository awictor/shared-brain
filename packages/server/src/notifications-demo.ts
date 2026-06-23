/**
 * notifications-demo.ts — Real-time notification feed UI
 *
 * GET /demo/notifications — notification feed with mark read/unread
 * GET /api/notifications — get notifications for current user
 * POST /api/notifications/read/:id — mark single notification as read
 * POST /api/notifications/read-all — mark all as read
 * GET /api/notifications/count — unread count
 * POST /api/notifications/test — simulate a test notification
 */

import type { Application } from 'express';
import type { NotificationManager } from './notifications.js';

export function registerNotificationsDemo(app: Application, notificationManager: NotificationManager): void {
  // API routes
  app.get('/api/notifications', (req, res) => {
    const userId = req.query['userId'] as string ?? 'local';
    try {
      const notifications = notificationManager.getAll(userId, 50);
      res.json({ notifications });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch notifications' });
    }
  });

  app.get('/api/notifications/count', (req, res) => {
    const userId = req.query['userId'] as string ?? 'local';
    try {
      const count = notificationManager.getCount(userId);
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to fetch count' });
    }
  });

  app.post('/api/notifications/read/:id', (req, res) => {
    try {
      notificationManager.markRead(req.params['id']);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to mark as read' });
    }
  });

  app.post('/api/notifications/read-all', (req, res) => {
    const userId = req.query['userId'] as string ?? 'local';
    try {
      notificationManager.markAllRead(userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to mark all as read' });
    }
  });

  app.post('/api/notifications/test', (req, res) => {
    const userId = req.query['userId'] as string ?? 'local';
    try {
      notificationManager.notify(
        userId,
        'related_memory',
        'Test Notification',
        'This is a test notification to verify the system is working.',
        undefined,
        'system',
      );
      res.json({ success: true, message: 'Test notification created' });
    } catch (err: any) {
      res.status(500).json({ error: err.message ?? 'Failed to create test notification' });
    }
  });

  // Demo page
  app.get('/demo/notifications', (_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notifications — SharedBrain</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #0f0f1e 100%);
      color: #e0e0e0;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { color: #888; margin-bottom: 2rem; }

    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding: 1rem;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
    }

    .user-input {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .user-input input {
      padding: 0.5rem;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 0.9rem;
    }

    .badge {
      background: #ff6b6b;
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: bold;
    }

    .actions {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.5rem;
    }

    button {
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      transition: transform 0.2s, opacity 0.2s;
    }

    button:hover { transform: translateY(-2px); opacity: 0.9; }
    button:active { transform: translateY(0); }

    button.secondary {
      background: rgba(255,255,255,0.1);
    }

    .notification-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .notification {
      background: rgba(255,255,255,0.05);
      padding: 1.5rem;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      transition: all 0.3s;
      position: relative;
    }

    .notification.unread {
      border-left: 4px solid #667eea;
      background: rgba(102, 126, 234, 0.1);
    }

    .notification.read {
      opacity: 0.6;
    }

    .notification-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 0.5rem;
    }

    .notification-type {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 0.5rem;
    }

    .type-related { background: rgba(102, 126, 234, 0.3); color: #a5b4fc; }
    .type-decision { background: rgba(251, 191, 36, 0.3); color: #fcd34d; }
    .type-referenced { background: rgba(59, 130, 246, 0.3); color: #60a5fa; }
    .type-milestone { background: rgba(34, 197, 94, 0.3); color: #4ade80; }

    .notification-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: #fff;
      margin-bottom: 0.5rem;
    }

    .notification-body {
      color: #ccc;
      line-height: 1.5;
      margin-bottom: 0.75rem;
    }

    .notification-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      color: #888;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgba(255,255,255,0.1);
    }

    .notification-actions {
      display: flex;
      gap: 0.5rem;
    }

    button.small {
      padding: 0.4rem 0.8rem;
      font-size: 0.85rem;
    }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: #888;
    }

    .empty-state svg {
      width: 64px;
      height: 64px;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .status {
      margin: 1rem 0;
      padding: 0.75rem;
      background: rgba(34, 197, 94, 0.1);
      border-left: 4px solid #22c55e;
      border-radius: 6px;
      color: #4ade80;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔔 Notifications</h1>
    <p class="subtitle">Real-time collaboration updates</p>

    <div class="header-bar">
      <div class="user-input">
        <label for="userId">User ID:</label>
        <input type="text" id="userId" value="local" placeholder="Enter user ID">
        <button class="secondary small" onclick="loadNotifications()">Refresh</button>
      </div>
      <div class="badge" id="unreadBadge">0</div>
    </div>

    <div class="actions">
      <button onclick="markAllRead()">Mark All Read</button>
      <button class="secondary" onclick="simulateNotification()">Simulate Test</button>
    </div>

    <div class="status" id="status"></div>

    <div class="notification-list" id="notificationList">
      <div class="empty-state">
        <svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
          <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
        </svg>
        <p>No notifications yet</p>
      </div>
    </div>
  </div>

  <script>
    let userId = 'local';

    function showStatus(message) {
      const status = document.getElementById('status');
      status.textContent = message;
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 3000);
    }

    async function loadNotifications() {
      userId = document.getElementById('userId').value || 'local';

      try {
        const [notifResp, countResp] = await Promise.all([
          fetch(\`/api/notifications?userId=\${encodeURIComponent(userId)}\`),
          fetch(\`/api/notifications/count?userId=\${encodeURIComponent(userId)}\`),
        ]);

        const { notifications } = await notifResp.json();
        const { count } = await countResp.json();

        document.getElementById('unreadBadge').textContent = count;

        const list = document.getElementById('notificationList');
        if (notifications.length === 0) {
          list.innerHTML = \`
            <div class="empty-state">
              <svg fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"/>
              </svg>
              <p>No notifications yet</p>
            </div>
          \`;
          return;
        }

        list.innerHTML = notifications.map(n => \`
          <div class="notification \${n.read ? 'read' : 'unread'}">
            <span class="notification-type type-\${n.type.split('_')[0]}">\${n.type.replace(/_/g, ' ')}</span>
            <div class="notification-title">\${n.title}</div>
            <div class="notification-body">\${n.body}</div>
            <div class="notification-meta">
              <span>\${new Date(n.createdAt).toLocaleString()}</span>
              <div class="notification-actions">
                \${!n.read ? \`<button class="small" onclick="markRead('\${n.id}')">Mark Read</button>\` : \`<span style="color: #4ade80;">✓ Read</span>\`}
              </div>
            </div>
          </div>
        \`).join('');
      } catch (err) {
        console.error('Failed to load notifications:', err);
      }
    }

    async function markRead(notificationId) {
      try {
        await fetch(\`/api/notifications/read/\${notificationId}\`, { method: 'POST' });
        showStatus('Marked as read');
        loadNotifications();
      } catch (err) {
        console.error('Failed to mark as read:', err);
      }
    }

    async function markAllRead() {
      try {
        await fetch(\`/api/notifications/read-all?userId=\${encodeURIComponent(userId)}\`, { method: 'POST' });
        showStatus('All notifications marked as read');
        loadNotifications();
      } catch (err) {
        console.error('Failed to mark all as read:', err);
      }
    }

    async function simulateNotification() {
      try {
        await fetch(\`/api/notifications/test?userId=\${encodeURIComponent(userId)}\`, { method: 'POST' });
        showStatus('Test notification created!');
        setTimeout(() => loadNotifications(), 500);
      } catch (err) {
        console.error('Failed to simulate notification:', err);
      }
    }

    // Auto-refresh every 5 seconds
    setInterval(loadNotifications, 5000);

    // Initial load
    loadNotifications();
  </script>
</body>
</html>
`);
  });
}
