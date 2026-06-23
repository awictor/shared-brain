/**
 * UX Enhancements Module — Serves /ux-enhance.js
 * Injected into the SharedBrain SPA to fix all heuristic issues.
 */

import type { Application } from 'express';

export function registerUXEnhancements(app: Application): void {
  app.get('/ux-enhance.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(UX_ENHANCE_JS);
  });

  // Tags API endpoint for autocomplete (falls back to empty if store not available)
  app.get('/api/tags', async (_req, res) => {
    try {
      // Try to get tags from the store via the app locals or a direct query
      const store = (app as any).locals?.store;
      if (store && typeof store.getAllTags === 'function') {
        const tags = await store.getAllTags();
        res.json(tags);
      } else {
        res.json([]);
      }
    } catch {
      res.json([]);
    }
  });
}

const UX_ENHANCE_JS = `(function() {
  'use strict';

  // ─── Inject styles ─────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.id = 'ux-enhance-styles';
  style.textContent = \`
    /* Progress bar */
    #ux-progress-bar {
      position: fixed; top: 0; left: 0; height: 3px; z-index: 99999;
      background: linear-gradient(90deg, #FF6100, #ff8c42);
      width: 0; opacity: 0; transition: opacity 200ms;
      pointer-events: none;
    }
    #ux-progress-bar.active {
      opacity: 1;
      animation: ux-progress 1.5s ease-in-out infinite;
    }
    @keyframes ux-progress {
      0% { width: 0; left: 0; }
      50% { width: 60%; left: 20%; }
      100% { width: 0; left: 100%; }
    }

    /* Undo toast */
    .ux-undo-toast {
      position: fixed; bottom: 80px; right: 24px; z-index: 99998;
      background: #232F3E; border: 1px solid #FF6100; border-radius: 8px;
      padding: 14px 20px; color: #F5F3EF; font-size: 13px; font-family: Inter, system-ui, sans-serif;
      display: flex; align-items: center; gap: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      animation: ux-toast-in 300ms ease;
    }
    .ux-undo-toast .ux-undo-btn {
      background: #FF6100; color: #fff; border: none; border-radius: 4px;
      padding: 6px 14px; font-weight: 600; font-size: 12px; cursor: pointer;
      transition: background 200ms;
    }
    .ux-undo-toast .ux-undo-btn:hover { background: #e55800; }
    @keyframes ux-toast-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    /* Confirmation modal */
    .ux-modal-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
      animation: ux-fade-in 150ms ease;
    }
    .ux-modal {
      background: #232F3E; border: 1px solid #3a4a5a; border-radius: 12px;
      padding: 28px 32px; min-width: 340px; max-width: 480px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5); font-family: Inter, system-ui, sans-serif;
    }
    .ux-modal h3 { color: #F5F3EF; font-size: 16px; margin-bottom: 12px; }
    .ux-modal p { color: #8a9aaa; font-size: 13px; margin-bottom: 20px; line-height: 1.5; }
    .ux-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
    .ux-modal-actions button {
      padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600;
      border: none; cursor: pointer; transition: all 200ms;
    }
    .ux-modal-actions .ux-confirm { background: #FF6100; color: #fff; }
    .ux-modal-actions .ux-confirm:hover { background: #e55800; }
    .ux-modal-actions .ux-cancel { background: transparent; border: 1px solid #3a4a5a; color: #F5F3EF; }
    .ux-modal-actions .ux-cancel:hover { border-color: #FF6100; color: #FF6100; }
    @keyframes ux-fade-in { from { opacity: 0; } to { opacity: 1; } }

    /* Empty content validation */
    .ux-invalid-border { border-color: #ef4444 !important; }
    .ux-validation-msg {
      color: #ef4444; font-size: 11px; margin-top: 4px;
      font-family: Inter, system-ui, sans-serif;
    }

    /* Tag autocomplete */
    .ux-tag-dropdown {
      position: absolute; z-index: 10000;
      background: #232F3E; border: 1px solid #3a4a5a; border-radius: 6px;
      max-height: 180px; overflow-y: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      font-family: Inter, system-ui, sans-serif;
    }
    .ux-tag-dropdown-item {
      padding: 8px 14px; font-size: 12px; color: #F5F3EF; cursor: pointer;
      transition: background 100ms;
    }
    .ux-tag-dropdown-item:hover, .ux-tag-dropdown-item.active {
      background: rgba(255, 97, 0, 0.12); color: #FF6100;
    }

    /* Keyboard shortcut overlay / command palette */
    .ux-shortcut-overlay {
      position: fixed; inset: 0; z-index: 100001;
      background: rgba(0,0,0,0.65); display: flex; align-items: flex-start; justify-content: center;
      padding-top: 120px; animation: ux-fade-in 150ms ease;
    }
    .ux-shortcut-panel {
      background: #232F3E; border: 1px solid #3a4a5a; border-radius: 12px;
      padding: 24px 28px; width: 440px; max-height: 460px; overflow-y: auto;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5); font-family: Inter, system-ui, sans-serif;
    }
    .ux-shortcut-panel h2 { color: #FF6100; font-size: 15px; margin-bottom: 16px; }
    .ux-shortcut-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px 0; border-bottom: 1px solid rgba(58, 74, 90, 0.4);
    }
    .ux-shortcut-row:last-child { border-bottom: none; }
    .ux-shortcut-label { font-size: 13px; color: #F5F3EF; }
    .ux-shortcut-key {
      font-size: 11px; background: #1a2332; border: 1px solid #3a4a5a;
      border-radius: 4px; padding: 3px 8px; color: #8a9aaa; font-family: monospace;
    }

    /* Help panel */
    .ux-help-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 99990;
      width: 48px; height: 48px; border-radius: 50%;
      background: #FF6100; color: #fff; border: none;
      font-size: 20px; font-weight: 700; cursor: pointer;
      box-shadow: 0 4px 16px rgba(255, 97, 0, 0.4);
      transition: transform 200ms, box-shadow 200ms;
      font-family: Inter, system-ui, sans-serif;
    }
    .ux-help-btn:hover { transform: scale(1.08); box-shadow: 0 6px 24px rgba(255, 97, 0, 0.5); }
    .ux-help-panel {
      position: fixed; top: 0; right: -360px; bottom: 0; z-index: 99991;
      width: 340px; background: #232F3E; border-left: 1px solid #3a4a5a;
      padding: 24px; overflow-y: auto; transition: right 300ms ease;
      box-shadow: -4px 0 24px rgba(0,0,0,0.3); font-family: Inter, system-ui, sans-serif;
    }
    .ux-help-panel.open { right: 0; }
    .ux-help-panel h3 { color: #FF6100; font-size: 14px; margin: 16px 0 10px; }
    .ux-help-panel h3:first-child { margin-top: 0; }
    .ux-help-panel ul { list-style: none; padding: 0; }
    .ux-help-panel li { padding: 6px 0; font-size: 13px; color: #8a9aaa; border-bottom: 1px solid rgba(58,74,90,0.3); }
    .ux-help-panel li:last-child { border-bottom: none; }
    .ux-help-panel .ux-help-close {
      position: absolute; top: 16px; right: 16px; background: none; border: none;
      color: #8a9aaa; font-size: 20px; cursor: pointer; padding: 4px;
    }
    .ux-help-panel .ux-help-close:hover { color: #F5F3EF; }
    .ux-help-panel a { color: #FF6100; text-decoration: none; font-size: 13px; }
    .ux-help-panel a:hover { opacity: 0.8; }

    /* Tour tooltips */
    .ux-tour-tooltip {
      position: fixed; z-index: 100002;
      background: #232F3E; border: 1px solid #FF6100; border-radius: 8px;
      padding: 16px 20px; max-width: 280px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); font-family: Inter, system-ui, sans-serif;
      animation: ux-tooltip-in 200ms ease;
    }
    .ux-tour-tooltip p { color: #F5F3EF; font-size: 13px; margin-bottom: 12px; line-height: 1.5; }
    .ux-tour-tooltip .ux-tour-step { color: #8a9aaa; font-size: 11px; margin-bottom: 8px; }
    .ux-tour-tooltip .ux-tour-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .ux-tour-tooltip .ux-tour-actions button {
      padding: 6px 14px; border-radius: 4px; font-size: 12px; font-weight: 600;
      border: none; cursor: pointer;
    }
    .ux-tour-tooltip .ux-tour-next { background: #FF6100; color: #fff; }
    .ux-tour-tooltip .ux-tour-next:hover { background: #e55800; }
    .ux-tour-tooltip .ux-tour-skip { background: transparent; color: #8a9aaa; border: 1px solid #3a4a5a; }
    .ux-tour-tooltip .ux-tour-skip:hover { border-color: #8a9aaa; }
    .ux-tour-arrow {
      position: absolute; width: 10px; height: 10px; background: #232F3E;
      border-left: 1px solid #FF6100; border-top: 1px solid #FF6100;
      transform: rotate(45deg);
    }
    @keyframes ux-tooltip-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    /* Error recovery toast */
    .ux-error-toast {
      position: fixed; bottom: 80px; right: 24px; z-index: 99997;
      background: #1a2332; border: 1px solid #ef4444; border-radius: 8px;
      padding: 14px 20px; color: #F5F3EF; font-size: 13px; max-width: 360px;
      font-family: Inter, system-ui, sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); animation: ux-toast-in 300ms ease;
    }
    .ux-error-toast .ux-error-msg { color: #ef4444; margin-bottom: 8px; font-weight: 500; }
    .ux-error-toast .ux-retry-btn {
      background: #ef4444; color: #fff; border: none; border-radius: 4px;
      padding: 6px 14px; font-weight: 600; font-size: 12px; cursor: pointer;
    }
    .ux-error-toast .ux-retry-btn:hover { background: #dc2626; }

    /* Empty search state */
    .ux-empty-search {
      text-align: center; padding: 40px 20px; color: #8a9aaa;
      font-family: Inter, system-ui, sans-serif;
    }
    .ux-empty-search h4 { color: #F5F3EF; font-size: 15px; margin-bottom: 12px; }
    .ux-empty-search ul { list-style: none; padding: 0; font-size: 13px; }
    .ux-empty-search li { padding: 4px 0; }
    .ux-empty-search kbd {
      background: #232F3E; border: 1px solid #3a4a5a; border-radius: 3px;
      padding: 1px 5px; font-size: 11px; font-family: monospace;
    }

    /* ─── Ownership UI ─────────────────────────────────────────────────────── */

    /* Ownership badge pills */
    .ux-owner-badge {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;
      font-family: Inter, system-ui, sans-serif; line-height: 1.4;
      vertical-align: middle; margin-left: 8px;
    }
    .ux-owner-badge.ux-badge-you {
      background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3);
    }
    .ux-owner-badge.ux-badge-other {
      background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .ux-owner-dot {
      width: 6px; height: 6px; border-radius: 50%; display: inline-block;
    }

    /* User identity chip in topbar */
    .ux-user-chip {
      position: fixed; top: 12px; right: 80px; z-index: 99995;
      display: flex; align-items: center; gap: 8px;
      background: #1a2332; border: 1px solid #3a4a5a; border-radius: 20px;
      padding: 4px 14px 4px 4px; cursor: pointer;
      font-family: Inter, system-ui, sans-serif; transition: border-color 200ms;
    }
    .ux-user-chip:hover { border-color: #FF6100; }
    .ux-user-avatar {
      width: 26px; height: 26px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 700; color: #fff;
    }
    .ux-user-name { font-size: 12px; color: #F5F3EF; font-weight: 500; }
    .ux-user-dropdown {
      position: absolute; top: 38px; right: 0; min-width: 180px;
      background: #232F3E; border: 1px solid #3a4a5a; border-radius: 8px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5); display: none;
      font-family: Inter, system-ui, sans-serif; overflow: hidden;
    }
    .ux-user-dropdown.open { display: block; }
    .ux-user-dropdown-item {
      padding: 10px 16px; font-size: 12px; color: #F5F3EF; cursor: pointer;
      display: flex; align-items: center; gap: 8px; transition: background 100ms;
    }
    .ux-user-dropdown-item:hover { background: rgba(255, 97, 0, 0.1); }
    .ux-user-dropdown-item.active { color: #FF6100; }
    .ux-user-dropdown-divider { height: 1px; background: #3a4a5a; margin: 4px 0; }

    /* My Memories filter toggle */
    .ux-my-memories-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 500;
      font-family: Inter, system-ui, sans-serif; cursor: pointer;
      border: 1px solid #3a4a5a; background: transparent; color: #8a9aaa;
      transition: all 200ms; margin-left: 8px;
    }
    .ux-my-memories-toggle:hover { border-color: #FF6100; color: #F5F3EF; }
    .ux-my-memories-toggle.active {
      background: rgba(255, 97, 0, 0.12); border-color: #FF6100; color: #FF6100;
    }

    /* Permission denied toast */
    .ux-permission-toast {
      position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); z-index: 99999;
      background: #232F3E; border: 1px solid #ef4444; border-radius: 8px;
      padding: 12px 20px; color: #ef4444; font-size: 13px; font-weight: 500;
      font-family: Inter, system-ui, sans-serif;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      animation: ux-toast-in 300ms ease;
    }

    /* Card shake animation */
    @keyframes ux-shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
      20%, 40%, 60%, 80% { transform: translateX(4px); }
    }
    .ux-shake { animation: ux-shake 0.5s ease; }

    /* User color-coded left border on cards */
    .ux-user-border {
      border-left: 3px solid var(--ux-user-color, #3a4a5a) !important;
    }

    /* ─── Mobile Responsive Styles ──────────────────────────────────────────── */
    @media (max-width: 768px) {
      /* 1. Responsive Sidebar */
      .sidebar, nav.sidebar, aside.sidebar, [class*="sidebar"] {
        position: fixed !important;
        top: 0;
        left: -280px;
        width: 280px;
        height: 100vh;
        z-index: 100005;
        transition: left 300ms ease;
        box-shadow: 4px 0 24px rgba(0,0,0,0.3);
      }
      .sidebar.ux-mobile-open {
        left: 0;
      }

      /* Mobile backdrop */
      .ux-mobile-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 100004;
        display: none;
        animation: ux-fade-in 200ms ease;
      }
      .ux-mobile-backdrop.active {
        display: block;
      }

      /* Hamburger menu button */
      .ux-hamburger {
        position: fixed;
        top: 12px;
        left: 12px;
        z-index: 100006;
        width: 44px;
        height: 44px;
        background: #232F3E;
        border: 1px solid #3a4a5a;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        cursor: pointer;
        transition: all 200ms;
      }
      .ux-hamburger:hover {
        border-color: #FF6100;
      }
      .ux-hamburger span {
        width: 20px;
        height: 2px;
        background: #F5F3EF;
        border-radius: 2px;
        transition: all 200ms;
      }
      .ux-hamburger.active span:nth-child(1) {
        transform: translateY(6px) rotate(45deg);
      }
      .ux-hamburger.active span:nth-child(2) {
        opacity: 0;
      }
      .ux-hamburger.active span:nth-child(3) {
        transform: translateY(-6px) rotate(-45deg);
      }

      /* 2. Touch-friendly targets */
      button, .btn, a.btn, [role="button"] {
        min-height: 44px !important;
        padding: 12px 16px !important;
      }

      .memory-card, .result-card, [data-memory-id] {
        padding: 20px !important;
        margin-bottom: 16px !important;
      }

      /* Search input full-width with larger font */
      #global-search, input[type="search"], input.search-input {
        width: 100% !important;
        font-size: 16px !important; /* Prevents iOS zoom */
        padding: 12px 16px !important;
      }

      /* Nav items stacked with more spacing */
      .nav-item, nav a, .sidebar a {
        display: block !important;
        padding: 14px 16px !important;
        margin: 4px 0 !important;
      }

      /* 3. Mobile search overlay */
      .ux-mobile-search-overlay {
        position: fixed;
        inset: 0;
        z-index: 100007;
        background: #1a2332;
        display: none;
        flex-direction: column;
        animation: ux-fade-in 200ms ease;
      }
      .ux-mobile-search-overlay.active {
        display: flex;
      }
      .ux-mobile-search-header {
        display: flex;
        align-items: center;
        padding: 12px;
        background: #232F3E;
        border-bottom: 1px solid #3a4a5a;
        gap: 12px;
      }
      .ux-mobile-search-back {
        min-width: 44px;
        height: 44px;
        background: transparent;
        border: none;
        color: #F5F3EF;
        font-size: 20px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .ux-mobile-search-input {
        flex: 1;
        background: #1a2332;
        border: 1px solid #3a4a5a;
        border-radius: 8px;
        padding: 12px 16px;
        color: #F5F3EF;
        font-size: 16px;
        font-family: Inter, system-ui, sans-serif;
      }
      .ux-mobile-search-results {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
      }

      /* 4. Bottom action bar */
      .ux-mobile-action-bar {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 64px;
        background: #232F3E;
        border-top: 1px solid #3a4a5a;
        display: flex;
        justify-content: space-around;
        align-items: center;
        z-index: 100003;
        box-shadow: 0 -4px 16px rgba(0,0,0,0.3);
      }
      .ux-mobile-action-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-width: 64px;
        height: 100%;
        background: transparent;
        border: none;
        color: #8a9aaa;
        font-size: 20px;
        cursor: pointer;
        transition: color 200ms;
        font-family: Inter, system-ui, sans-serif;
      }
      .ux-mobile-action-btn:hover, .ux-mobile-action-btn.active {
        color: #FF6100;
      }
      .ux-mobile-action-label {
        font-size: 11px;
        font-weight: 500;
      }

      /* Adjust main content to account for action bar */
      .main, main, #app, .content {
        padding-bottom: 80px !important;
      }

      /* Hide help button on mobile (use bottom bar instead) */
      .ux-help-btn {
        display: none;
      }

      /* Adjust user chip position for hamburger */
      .ux-user-chip {
        top: 12px;
        right: 12px;
        left: auto;
      }

      /* Modals full-width on mobile */
      .ux-modal {
        min-width: 90vw;
        max-width: 90vw;
        margin: 20px;
      }

      /* Help panel full-width */
      .ux-help-panel {
        width: 100vw;
        right: -100vw;
      }
      .ux-help-panel.open {
        right: 0;
      }

      /* Shortcut panel responsive */
      .ux-shortcut-panel {
        width: 90vw;
        max-width: 90vw;
      }

      /* Toast positioning */
      .ux-undo-toast, .ux-error-toast {
        bottom: 80px;
        right: 12px;
        left: 12px;
        max-width: calc(100vw - 24px);
      }

      /* Tag dropdown full-width */
      .ux-tag-dropdown {
        left: 0 !important;
        right: 0 !important;
        width: 100% !important;
      }

      /* Cards grid to single column */
      .memory-grid, .results-grid, [class*="grid"] {
        grid-template-columns: 1fr !important;
      }
    }
  \`;
  document.head.appendChild(style);

  // ─── 1. Loading Indicator ──────────────────────────────────────────────────
  var progressBar = document.createElement('div');
  progressBar.id = 'ux-progress-bar';
  document.body.appendChild(progressBar);

  var activeRequests = 0;
  var originalFetch = window.fetch;
  window.fetch = function() {
    activeRequests++;
    progressBar.classList.add('active');
    return originalFetch.apply(this, arguments).then(function(response) {
      activeRequests--;
      if (activeRequests <= 0) { activeRequests = 0; progressBar.classList.remove('active'); }
      return response;
    }).catch(function(err) {
      activeRequests--;
      if (activeRequests <= 0) { activeRequests = 0; progressBar.classList.remove('active'); }
      throw err;
    });
  };

  // ─── 2. Undo Delete ────────────────────────────────────────────────────────
  // Intercept delete calls from MCP. We detect if the mcpCall function calls memory_delete.
  var pendingDeletes = [];

  // Monkey-patch the global mcpCall if it exists, otherwise intercept fetch for delete patterns
  function setupUndoDelete() {
    if (typeof window.mcpCall === 'function') {
      var origMcpCall = window.mcpCall;
      window.mcpCall = function(toolName, args) {
        if (toolName === 'memory_delete' || toolName === 'delete_memory') {
          return new Promise(function(resolve, reject) {
            var countdown = 5;
            var cancelled = false;
            var toastEl = document.createElement('div');
            toastEl.className = 'ux-undo-toast';
            toastEl.innerHTML = '<span>Memory deleted &mdash; Undo (<span class="ux-countdown">' + countdown + '</span>s)</span><button class="ux-undo-btn">Undo</button>';
            document.body.appendChild(toastEl);

            var undoBtn = toastEl.querySelector('.ux-undo-btn');
            var countdownEl = toastEl.querySelector('.ux-countdown');
            undoBtn.addEventListener('click', function() {
              cancelled = true;
              toastEl.remove();
              resolve({ undone: true });
            });

            var interval = setInterval(function() {
              countdown--;
              countdownEl.textContent = countdown;
              if (countdown <= 0) {
                clearInterval(interval);
                toastEl.remove();
                if (!cancelled) {
                  origMcpCall(toolName, args).then(resolve).catch(reject);
                }
              }
            }, 1000);
          });
        }
        return origMcpCall(toolName, args);
      };
    }
  }
  // Retry setup after page loads (mcpCall defined in SPA script)
  setTimeout(setupUndoDelete, 500);

  // ─── 3. Confirmation Modal ─────────────────────────────────────────────────
  window.confirmAction = function(message) {
    return new Promise(function(resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'ux-modal-overlay';
      overlay.innerHTML = '<div class="ux-modal"><h3>Confirm Action</h3><p>' + escapeHtml(message) + '</p><div class="ux-modal-actions"><button class="ux-cancel">Cancel</button><button class="ux-confirm">Confirm</button></div></div>';
      document.body.appendChild(overlay);

      overlay.querySelector('.ux-confirm').addEventListener('click', function() {
        overlay.remove();
        resolve(true);
      });
      overlay.querySelector('.ux-cancel').addEventListener('click', function() {
        overlay.remove();
        resolve(false);
      });
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) { overlay.remove(); resolve(false); }
      });
    });
  };

  // ─── 4. Empty Content Validation ──────────────────────────────────────────
  function setupValidation() {
    var textarea = document.getElementById('store-content');
    var storeBtn = document.querySelector('[onclick="storeMemory()"]');
    if (!textarea || !storeBtn) return;

    var validationMsg = document.createElement('div');
    validationMsg.className = 'ux-validation-msg';
    validationMsg.textContent = 'Content required';
    validationMsg.style.display = 'none';
    textarea.parentElement.appendChild(validationMsg);

    function validate() {
      var empty = !textarea.value.trim();
      if (empty) {
        textarea.classList.add('ux-invalid-border');
        validationMsg.style.display = 'block';
        storeBtn.disabled = true;
        storeBtn.style.opacity = '0.5';
        storeBtn.style.cursor = 'not-allowed';
      } else {
        textarea.classList.remove('ux-invalid-border');
        validationMsg.style.display = 'none';
        storeBtn.disabled = false;
        storeBtn.style.opacity = '1';
        storeBtn.style.cursor = 'pointer';
      }
    }

    textarea.addEventListener('input', validate);
    validate(); // initial state
  }

  // ─── 5. Tag Autocomplete ──────────────────────────────────────────────────
  function setupTagAutocomplete() {
    var tagsInput = document.getElementById('store-tags');
    if (!tagsInput) return;

    var allTags = [];
    var dropdown = null;
    var activeIndex = -1;

    tagsInput.style.position = 'relative';
    var wrapper = tagsInput.parentElement;
    wrapper.style.position = 'relative';

    function createDropdown() {
      if (dropdown) dropdown.remove();
      dropdown = document.createElement('div');
      dropdown.className = 'ux-tag-dropdown';
      var rect = tagsInput.getBoundingClientRect();
      dropdown.style.top = (tagsInput.offsetTop + tagsInput.offsetHeight + 2) + 'px';
      dropdown.style.left = tagsInput.offsetLeft + 'px';
      dropdown.style.width = tagsInput.offsetWidth + 'px';
      wrapper.appendChild(dropdown);
      return dropdown;
    }

    function hideDropdown() {
      if (dropdown) { dropdown.remove(); dropdown = null; }
      activeIndex = -1;
    }

    function showMatches(query) {
      var parts = query.split(',');
      var current = (parts[parts.length - 1] || '').trim().toLowerCase();
      if (!current) { hideDropdown(); return; }

      var existing = parts.slice(0, -1).map(function(t) { return t.trim().toLowerCase(); });
      var matches = allTags.filter(function(t) {
        return t.toLowerCase().indexOf(current) !== -1 && existing.indexOf(t.toLowerCase()) === -1;
      }).slice(0, 8);

      if (!matches.length) { hideDropdown(); return; }

      var dd = createDropdown();
      dd.innerHTML = matches.map(function(t, i) {
        return '<div class="ux-tag-dropdown-item" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</div>';
      }).join('');

      dd.querySelectorAll('.ux-tag-dropdown-item').forEach(function(item) {
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          selectTag(item.getAttribute('data-tag'));
        });
      });
    }

    function selectTag(tag) {
      var parts = tagsInput.value.split(',');
      parts[parts.length - 1] = ' ' + tag;
      tagsInput.value = parts.join(',') + ', ';
      tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
      hideDropdown();
      tagsInput.focus();
    }

    tagsInput.addEventListener('focus', function() {
      fetch('/api/tags').then(function(r) { return r.json(); }).then(function(data) {
        allTags = (Array.isArray(data) ? data : data.tags || []).map(function(t) {
          return typeof t === 'string' ? t : t.tag || t.name || '';
        }).filter(Boolean);
      }).catch(function() {});
    });

    tagsInput.addEventListener('input', function() { showMatches(tagsInput.value); });
    tagsInput.addEventListener('blur', function() { setTimeout(hideDropdown, 200); });
    tagsInput.addEventListener('keydown', function(e) {
      if (!dropdown) return;
      var items = dropdown.querySelectorAll('.ux-tag-dropdown-item');
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = Math.min(activeIndex + 1, items.length - 1); updateActive(items); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = Math.max(activeIndex - 1, 0); updateActive(items); }
      else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); selectTag(items[activeIndex].getAttribute('data-tag')); }
      else if (e.key === 'Escape') { hideDropdown(); }
    });

    function updateActive(items) {
      items.forEach(function(item, i) {
        item.classList.toggle('active', i === activeIndex);
      });
    }
  }

  // ─── 6. Keyboard Shortcut Overlay ─────────────────────────────────────────
  var shortcutOverlayOpen = false;

  function showShortcutOverlay() {
    if (shortcutOverlayOpen) return;
    shortcutOverlayOpen = true;
    var overlay = document.createElement('div');
    overlay.className = 'ux-shortcut-overlay';
    overlay.id = 'ux-shortcut-overlay';
    overlay.innerHTML = '<div class="ux-shortcut-panel"><h2>Keyboard Shortcuts</h2>'
      + shortcutRow('Focus search', '/')
      + shortcutRow('New memory', 'N')
      + shortcutRow('Close / blur', 'Esc')
      + shortcutRow('Dashboard', '1')
      + shortcutRow('Search', '2')
      + shortcutRow('Store', '3')
      + shortcutRow('Checkin', '4')
      + shortcutRow('Ingestion Log', '5')
      + shortcutRow('Sync', '6')
      + shortcutRow('Agents', '7')
      + shortcutRow('Security', '8')
      + shortcutRow('Status', '9')
      + shortcutRow('Show shortcuts', 'Ctrl+? / Cmd+K')
      + shortcutRow('Help panel', '?  (button)')
      + '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeShortcutOverlay();
    });
  }

  function closeShortcutOverlay() {
    var el = document.getElementById('ux-shortcut-overlay');
    if (el) el.remove();
    shortcutOverlayOpen = false;
  }

  function shortcutRow(label, key) {
    return '<div class="ux-shortcut-row"><span class="ux-shortcut-label">' + label + '</span><span class="ux-shortcut-key">' + key + '</span></div>';
  }

  document.addEventListener('keydown', function(e) {
    // Ctrl+? or Cmd+K
    if ((e.ctrlKey && e.key === '?') || (e.metaKey && e.key === 'k') || (e.ctrlKey && e.shiftKey && e.key === '/')) {
      e.preventDefault();
      if (shortcutOverlayOpen) closeShortcutOverlay();
      else showShortcutOverlay();
      return;
    }
    if (e.key === 'Escape' && shortcutOverlayOpen) {
      closeShortcutOverlay();
      return;
    }
    // Number keys for nav (only when not in input)
    var tag = document.activeElement && document.activeElement.tagName ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    var pages = ['dashboard','search','store','checkin','ingest','sync','agents','security','status'];
    var num = parseInt(e.key);
    if (num >= 1 && num <= 9 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var target = pages[num - 1];
      if (target) location.hash = '#' + target;
    }
  });

  // ─── 7. Help Panel ────────────────────────────────────────────────────────
  var helpBtn = document.createElement('button');
  helpBtn.className = 'ux-help-btn';
  helpBtn.textContent = '?';
  helpBtn.title = 'Help';
  document.body.appendChild(helpBtn);

  var helpPanel = document.createElement('div');
  helpPanel.className = 'ux-help-panel';
  helpPanel.innerHTML = '<button class="ux-help-close">&times;</button>'
    + '<h3>Keyboard Shortcuts</h3><ul>'
    + '<li><strong>/</strong> &mdash; Focus search</li>'
    + '<li><strong>N</strong> &mdash; New memory</li>'
    + '<li><strong>Esc</strong> &mdash; Close/blur</li>'
    + '<li><strong>1-9</strong> &mdash; Navigate pages</li>'
    + '<li><strong>Ctrl+?</strong> &mdash; Command palette</li>'
    + '</ul>'
    + '<h3>Quick Guide</h3><ul>'
    + '<li>Use the search bar or press / to find memories semantically</li>'
    + '<li>Press N or navigate to Store to save a new memory</li>'
    + '<li>Check your Briefing page for daily context and activity</li>'
    + '</ul>'
    + '<h3>About</h3><ul>'
    + '<li><a href="https://github.com/shared-brain" target="_blank">About SharedBrain</a></li>'
    + '</ul>';
  document.body.appendChild(helpPanel);

  helpBtn.addEventListener('click', function() {
    helpPanel.classList.toggle('open');
  });
  helpPanel.querySelector('.ux-help-close').addEventListener('click', function() {
    helpPanel.classList.remove('open');
  });

  // ─── 8. First-Run Tour ────────────────────────────────────────────────────
  function startTour() {
    if (localStorage.getItem('sb-tour-done')) return;

    var steps = [
      { selector: '#global-search', text: 'Use the search bar to find memories semantically', position: 'bottom' },
      { selector: '.nav-item[href="#store"]', text: 'Press N to quickly store a new memory', position: 'right' },
      { selector: '.nav-item[href="#checkin"]', text: 'Check your briefing for daily context', position: 'right' },
      { selector: '.main', text: 'All memories are auto-organized for you', position: 'center' },
    ];

    var currentStep = 0;

    function showStep(idx) {
      removeTooltip();
      if (idx >= steps.length) {
        localStorage.setItem('sb-tour-done', '1');
        return;
      }

      var step = steps[idx];
      var target = document.querySelector(step.selector);
      if (!target) { currentStep++; showStep(currentStep); return; }

      var rect = target.getBoundingClientRect();
      var tooltip = document.createElement('div');
      tooltip.className = 'ux-tour-tooltip';
      tooltip.id = 'ux-tour-tooltip';
      tooltip.innerHTML = '<div class="ux-tour-step">Step ' + (idx + 1) + ' of ' + steps.length + '</div>'
        + '<p>' + step.text + '</p>'
        + '<div class="ux-tour-actions">'
        + '<button class="ux-tour-skip">Skip</button>'
        + '<button class="ux-tour-next">' + (idx === steps.length - 1 ? 'Done' : 'Next') + '</button>'
        + '</div>';

      document.body.appendChild(tooltip);

      // Position tooltip
      var tw = 280;
      if (step.position === 'bottom') {
        tooltip.style.top = (rect.bottom + 12) + 'px';
        tooltip.style.left = Math.max(8, rect.left + rect.width / 2 - tw / 2) + 'px';
      } else if (step.position === 'right') {
        tooltip.style.top = (rect.top) + 'px';
        tooltip.style.left = (rect.right + 12) + 'px';
      } else {
        tooltip.style.top = '50%';
        tooltip.style.left = '50%';
        tooltip.style.transform = 'translate(-50%, -50%)';
      }

      tooltip.querySelector('.ux-tour-next').addEventListener('click', function() {
        currentStep++;
        showStep(currentStep);
      });
      tooltip.querySelector('.ux-tour-skip').addEventListener('click', function() {
        removeTooltip();
        localStorage.setItem('sb-tour-done', '1');
      });
    }

    function removeTooltip() {
      var el = document.getElementById('ux-tour-tooltip');
      if (el) el.remove();
    }

    // Start tour after a short delay so page renders first
    setTimeout(function() { showStep(0); }, 1000);
  }

  // ─── 9. Empty Search State ────────────────────────────────────────────────
  function setupEmptySearchState() {
    // Observe the search results container for changes
    var resultsEl = document.getElementById('search-results');
    if (!resultsEl) return;

    var observer = new MutationObserver(function() {
      // Check if the empty state shows "No results found"
      var emptyState = resultsEl.querySelector('.empty-state');
      if (emptyState && emptyState.textContent.indexOf('No results found') !== -1) {
        emptyState.innerHTML = '<div class="ux-empty-search">'
          + '<div style="font-size:48px;opacity:0.5;margin-bottom:12px">&#128528;</div>'
          + '<h4>No results found</h4>'
          + '<ul>'
          + '<li>Try broader terms</li>'
          + '<li>Try different phrasing</li>'
          + '<li>Store a new memory with <kbd>N</kbd></li>'
          + '</ul></div>';
      }
    });
    observer.observe(resultsEl, { childList: true, subtree: true });
  }

  // ─── 10. Error Recovery ───────────────────────────────────────────────────
  // Override fetch to catch errors and show retry toast
  var enhancedFetch = window.fetch;
  window.fetch = function() {
    var args = arguments;
    return enhancedFetch.apply(this, args).then(function(response) {
      if (!response.ok && response.status >= 500) {
        showErrorToast('Server error: ' + response.status + ' ' + response.statusText, args);
      }
      return response;
    }).catch(function(err) {
      showErrorToast(err.message || 'Network error', args);
      throw err;
    });
  };

  function showErrorToast(message, fetchArgs) {
    // Remove existing error toasts
    var existing = document.querySelector('.ux-error-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'ux-error-toast';
    toast.innerHTML = '<div class="ux-error-msg">' + escapeHtml(message) + '</div>'
      + '<button class="ux-retry-btn">Retry</button>';
    document.body.appendChild(toast);

    toast.querySelector('.ux-retry-btn').addEventListener('click', function() {
      toast.remove();
      enhancedFetch.apply(window, fetchArgs).catch(function() {});
    });

    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 8000);
  }

  // ─── Utility ──────────────────────────────────────────────────────────────
  function escapeHtml(s) {
    if (!s) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  // ─── 11. Ownership-Aware UI ────────────────────────────────────────────────

  // Utility: hash authorId to a consistent HSL color
  function userColor(authorId) {
    if (!authorId) return '#3a4a5a';
    var hash = 0;
    for (var i = 0; i < authorId.length; i++) {
      hash = authorId.charCodeAt(i) + ((hash << 5) - hash);
      hash = hash & hash;
    }
    var hue = Math.abs(hash) % 360;
    return 'hsl(' + hue + ', 60%, 55%)';
  }

  // Get current user name from localStorage
  function getCurrentUser() {
    return localStorage.getItem('sb-user-name') || 'anonymous';
  }

  // Set current user name
  function setCurrentUser(name) {
    localStorage.setItem('sb-user-name', name);
  }

  // Check if "My Memories" filter is active
  function isMyMemoriesFilter() {
    return localStorage.getItem('sb-my-memories-filter') === '1';
  }

  function setMyMemoriesFilter(on) {
    localStorage.setItem('sb-my-memories-filter', on ? '1' : '0');
  }

  // ─── 11a. User Identity Chip ──────────────────────────────────────────────
  function setupUserChip() {
    var userName = getCurrentUser();
    var firstLetter = (userName.charAt(0) || '?').toUpperCase();
    var chipColor = userColor(userName);

    var chip = document.createElement('div');
    chip.className = 'ux-user-chip';
    chip.id = 'ux-user-chip';
    chip.innerHTML = '<div class="ux-user-avatar" style="background:' + chipColor + '">' + escapeHtml(firstLetter) + '</div>'
      + '<span class="ux-user-name">' + escapeHtml(userName) + '</span>'
      + '<div class="ux-user-dropdown" id="ux-user-dropdown">'
      + '<div class="ux-user-dropdown-item" id="ux-switch-user">&#x1f465; Switch User</div>'
      + '<div class="ux-user-dropdown-divider"></div>'
      + '<div class="ux-user-dropdown-item' + (isMyMemoriesFilter() ? ' active' : '') + '" id="ux-my-memories-dropdown">&#x1f4dd; My Memories Only</div>'
      + '</div>';
    document.body.appendChild(chip);

    var dropdown = document.getElementById('ux-user-dropdown');

    chip.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    document.addEventListener('click', function() {
      dropdown.classList.remove('open');
    });

    document.getElementById('ux-switch-user').addEventListener('click', function(e) {
      e.stopPropagation();
      var newName = prompt('Enter user alias:', getCurrentUser());
      if (newName && newName.trim()) {
        setCurrentUser(newName.trim());
        // Refresh the chip
        chip.remove();
        setupUserChip();
        applyOwnershipUI();
      }
      dropdown.classList.remove('open');
    });

    document.getElementById('ux-my-memories-dropdown').addEventListener('click', function(e) {
      e.stopPropagation();
      var current = isMyMemoriesFilter();
      setMyMemoriesFilter(!current);
      this.classList.toggle('active', !current);
      applyOwnershipUI();
      dropdown.classList.remove('open');
    });
  }

  // ─── 11b. My Memories Toggle Button ──────────────────────────────────────
  function setupMyMemoriesToggle() {
    // Find the search controls area and inject the toggle
    var searchControls = document.querySelector('.search-controls') || document.querySelector('#search-results')?.parentElement;
    if (!searchControls) return;

    // Check if toggle already exists
    if (document.getElementById('ux-my-memories-btn')) return;

    var toggle = document.createElement('button');
    toggle.className = 'ux-my-memories-toggle' + (isMyMemoriesFilter() ? ' active' : '');
    toggle.id = 'ux-my-memories-btn';
    toggle.innerHTML = '&#x1f464; My Memories';
    toggle.title = 'Show only your memories';

    toggle.addEventListener('click', function() {
      var current = isMyMemoriesFilter();
      setMyMemoriesFilter(!current);
      toggle.classList.toggle('active', !current);
      // Also sync the dropdown item
      var ddItem = document.getElementById('ux-my-memories-dropdown');
      if (ddItem) ddItem.classList.toggle('active', !current);
      applyOwnershipUI();
    });

    // Insert at the beginning of search controls
    searchControls.insertBefore(toggle, searchControls.firstChild);
  }

  // ─── 11c. Ownership Badges & Color Coding on Cards ────────────────────────
  function applyOwnershipUI() {
    var currentUser = getCurrentUser();
    var filterMyOnly = isMyMemoriesFilter();

    // Find all memory cards (common selectors)
    var cards = document.querySelectorAll('.memory-card, .result-card, [data-memory-id]');
    cards.forEach(function(card) {
      // Read ownership data from card attributes or embedded data
      var authorId = card.getAttribute('data-author') || card.getAttribute('data-author-id') || '';
      var isOwner = card.getAttribute('data-is-owner') === 'true' || (authorId && authorId === currentUser);

      // Remove previous badges
      var oldBadge = card.querySelector('.ux-owner-badge');
      if (oldBadge) oldBadge.remove();

      // Apply left border color
      var color = userColor(authorId || currentUser);
      card.style.setProperty('--ux-user-color', color);
      card.classList.add('ux-user-border');

      // Add ownership badge
      var badge = document.createElement('span');
      if (isOwner) {
        badge.className = 'ux-owner-badge ux-badge-you';
        badge.innerHTML = '<span class="ux-owner-dot" style="background:#22c55e"></span> You';
      } else if (authorId) {
        badge.className = 'ux-owner-badge ux-badge-other';
        badge.innerHTML = '<span class="ux-owner-dot" style="background:' + color + '"></span> ' + escapeHtml(authorId);
      }

      // Insert badge into card header/title area
      var header = card.querySelector('.card-header, .card-title, h3, h4, .memory-title');
      if (header) {
        header.appendChild(badge);
      } else {
        card.prepend(badge);
      }

      // Show/hide edit and delete buttons based on ownership
      var editBtns = card.querySelectorAll('.edit-btn, .delete-btn, [data-action="edit"], [data-action="delete"], button[onclick*="edit"], button[onclick*="delete"]');
      editBtns.forEach(function(btn) {
        if (isOwner) {
          btn.style.display = '';
        } else {
          btn.style.display = 'none';
        }
      });

      // My Memories filter: hide/show cards
      if (filterMyOnly) {
        card.style.display = isOwner ? '' : 'none';
      } else {
        card.style.display = '';
      }
    });
  }

  // ─── 11d. Permission Denied Toast & Shake ─────────────────────────────────
  function showPermissionDenied(cardEl) {
    // Show toast
    var existing = document.querySelector('.ux-permission-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.className = 'ux-permission-toast';
    toast.textContent = 'You can only edit your own memories';
    document.body.appendChild(toast);
    setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3500);

    // Shake animation on card
    if (cardEl) {
      cardEl.classList.add('ux-shake');
      setTimeout(function() { cardEl.classList.remove('ux-shake'); }, 600);
    }
  }

  // Intercept edit/delete actions on non-owned cards
  function setupPermissionGuards() {
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.edit-btn, .delete-btn, [data-action="edit"], [data-action="delete"]');
      if (!btn) return;

      var card = btn.closest('.memory-card, .result-card, [data-memory-id]');
      if (!card) return;

      var authorId = card.getAttribute('data-author') || card.getAttribute('data-author-id') || '';
      var isOwner = card.getAttribute('data-is-owner') === 'true' || (authorId && authorId === getCurrentUser());

      if (!isOwner) {
        e.preventDefault();
        e.stopPropagation();
        showPermissionDenied(card);
      }
    }, true); // capture phase to intercept before handlers
  }

  // ─── 11e. Observe DOM for dynamically loaded cards ────────────────────────
  function setupOwnershipObserver() {
    var targetNode = document.querySelector('.main, #app, main, body');
    if (!targetNode) targetNode = document.body;

    var debounceTimer = null;
    var observer = new MutationObserver(function() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        applyOwnershipUI();
        setupMyMemoriesToggle();
      }, 150);
    });
    observer.observe(targetNode, { childList: true, subtree: true });
  }

  // ─── 12. Mobile Responsive Enhancements ───────────────────────────────────

  var isMobile = window.innerWidth <= 768;

  // 12a. Hamburger menu + sidebar overlay
  function setupMobileSidebar() {
    if (!isMobile) return;

    // Create hamburger button
    var hamburger = document.createElement('button');
    hamburger.className = 'ux-hamburger';
    hamburger.innerHTML = '<span></span><span></span><span></span>';
    hamburger.setAttribute('aria-label', 'Menu');
    document.body.appendChild(hamburger);

    // Create backdrop
    var backdrop = document.createElement('div');
    backdrop.className = 'ux-mobile-backdrop';
    document.body.appendChild(backdrop);

    // Find sidebar
    var sidebar = document.querySelector('.sidebar, nav.sidebar, aside.sidebar, [class*="sidebar"]');
    if (!sidebar) return;

    function openSidebar() {
      sidebar.classList.add('ux-mobile-open');
      backdrop.classList.add('active');
      hamburger.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
      sidebar.classList.remove('ux-mobile-open');
      backdrop.classList.remove('active');
      hamburger.classList.remove('active');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', function(e) {
      e.stopPropagation();
      if (sidebar.classList.contains('ux-mobile-open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    });

    backdrop.addEventListener('click', closeSidebar);

    // Close sidebar when nav item clicked
    sidebar.addEventListener('click', function(e) {
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        setTimeout(closeSidebar, 150);
      }
    });

    // 12b. Swipe gestures
    var touchStartX = 0;
    var touchStartY = 0;
    var touchEndX = 0;
    var touchEndY = 0;

    document.addEventListener('touchstart', function(e) {
      touchStartX = e.changedTouches[0].screenX;
      touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    document.addEventListener('touchend', function(e) {
      touchEndX = e.changedTouches[0].screenX;
      touchEndY = e.changedTouches[0].screenY;
      handleSwipe();
    }, { passive: true });

    function handleSwipe() {
      var diffX = touchEndX - touchStartX;
      var diffY = touchEndY - touchStartY;
      var absDiffX = Math.abs(diffX);
      var absDiffY = Math.abs(diffY);

      // Only horizontal swipes with sufficient distance
      if (absDiffX < 80 || absDiffY > 50) return;

      // Swipe right from left edge (< 50px) → open sidebar
      if (diffX > 0 && touchStartX < 50 && !sidebar.classList.contains('ux-mobile-open')) {
        openSidebar();
      }
      // Swipe left → close sidebar
      else if (diffX < 0 && sidebar.classList.contains('ux-mobile-open')) {
        closeSidebar();
      }
    }
  }

  // 12c. Mobile search overlay
  function setupMobileSearch() {
    if (!isMobile) return;

    var searchOverlay = document.createElement('div');
    searchOverlay.className = 'ux-mobile-search-overlay';
    searchOverlay.id = 'ux-mobile-search-overlay';
    searchOverlay.innerHTML = '<div class="ux-mobile-search-header">'
      + '<button class="ux-mobile-search-back" aria-label="Back">&#x2190;</button>'
      + '<input type="search" class="ux-mobile-search-input" placeholder="Search memories..." />'
      + '</div>'
      + '<div class="ux-mobile-search-results" id="ux-mobile-search-results"></div>';
    document.body.appendChild(searchOverlay);

    var backBtn = searchOverlay.querySelector('.ux-mobile-search-back');
    var searchInput = searchOverlay.querySelector('.ux-mobile-search-input');
    var resultsContainer = searchOverlay.querySelector('.ux-mobile-search-results');

    function openMobileSearch() {
      searchOverlay.classList.add('active');
      searchInput.focus();
    }

    function closeMobileSearch() {
      searchOverlay.classList.remove('active');
      searchInput.value = '';
      resultsContainer.innerHTML = '';
    }

    backBtn.addEventListener('click', closeMobileSearch);

    // Hook into the global search input if it exists
    var globalSearch = document.getElementById('global-search');
    if (globalSearch) {
      globalSearch.addEventListener('focus', function() {
        if (isMobile) {
          openMobileSearch();
          globalSearch.blur();
        }
      });
    }

    // Mirror search results to mobile overlay
    searchInput.addEventListener('input', function() {
      var query = searchInput.value.trim();
      if (!query) {
        resultsContainer.innerHTML = '';
        return;
      }

      // If there's a search function on the page, call it
      if (typeof window.searchMemories === 'function') {
        window.searchMemories(query).then(function(results) {
          renderMobileResults(results);
        }).catch(function() {
          resultsContainer.innerHTML = '<div style="padding:20px;color:#8a9aaa;text-align:center">Search error</div>';
        });
      } else {
        // Fallback: show loading
        resultsContainer.innerHTML = '<div style="padding:20px;color:#8a9aaa;text-align:center">Searching...</div>';
      }
    });

    function renderMobileResults(results) {
      if (!results || !results.length) {
        resultsContainer.innerHTML = '<div style="padding:20px;color:#8a9aaa;text-align:center">No results found</div>';
        return;
      }

      resultsContainer.innerHTML = results.map(function(r) {
        return '<div class="memory-card" style="padding:16px;margin-bottom:12px;background:#232F3E;border:1px solid #3a4a5a;border-radius:8px">'
          + '<h4 style="color:#F5F3EF;font-size:14px;margin-bottom:8px">' + escapeHtml(r.title || r.content?.substring(0, 50) || 'Untitled') + '</h4>'
          + '<p style="color:#8a9aaa;font-size:12px">' + escapeHtml((r.content || '').substring(0, 100)) + '...</p>'
          + '</div>';
      }).join('');
    }
  }

  // 12d. Bottom action bar
  function setupMobileActionBar() {
    if (!isMobile) return;

    var actionBar = document.createElement('div');
    actionBar.className = 'ux-mobile-action-bar';
    actionBar.innerHTML = '<button class="ux-mobile-action-btn" data-action="search">'
      + '<span>&#128269;</span><span class="ux-mobile-action-label">Search</span>'
      + '</button>'
      + '<button class="ux-mobile-action-btn" data-action="store">'
      + '<span>&#10133;</span><span class="ux-mobile-action-label">Store</span>'
      + '</button>'
      + '<button class="ux-mobile-action-btn" data-action="checkin">'
      + '<span>&#128197;</span><span class="ux-mobile-action-label">Checkin</span>'
      + '</button>';
    document.body.appendChild(actionBar);

    actionBar.addEventListener('click', function(e) {
      var btn = e.target.closest('.ux-mobile-action-btn');
      if (!btn) return;

      var action = btn.getAttribute('data-action');

      // Remove active state from all buttons
      actionBar.querySelectorAll('.ux-mobile-action-btn').forEach(function(b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      // Navigate based on action
      if (action === 'search') {
        var searchOverlay = document.getElementById('ux-mobile-search-overlay');
        if (searchOverlay) {
          searchOverlay.classList.add('active');
          searchOverlay.querySelector('.ux-mobile-search-input').focus();
        }
      } else if (action === 'store') {
        location.hash = '#store';
      } else if (action === 'checkin') {
        location.hash = '#checkin';
      }
    });

    // Sync active state with current page
    function syncActionBar() {
      var hash = location.hash.replace('#', '') || 'dashboard';
      actionBar.querySelectorAll('.ux-mobile-action-btn').forEach(function(btn) {
        var action = btn.getAttribute('data-action');
        btn.classList.toggle('active', action === hash);
      });
    }

    window.addEventListener('hashchange', syncActionBar);
    syncActionBar();
  }

  // Update isMobile on resize
  window.addEventListener('resize', function() {
    var wasMobile = isMobile;
    isMobile = window.innerWidth <= 768;

    // Reinitialize mobile features if crossing threshold
    if (isMobile !== wasMobile) {
      // Clean up old elements
      var hamburger = document.querySelector('.ux-hamburger');
      var backdrop = document.querySelector('.ux-mobile-backdrop');
      var searchOverlay = document.getElementById('ux-mobile-search-overlay');
      var actionBar = document.querySelector('.ux-mobile-action-bar');

      if (hamburger) hamburger.remove();
      if (backdrop) backdrop.remove();
      if (searchOverlay) searchOverlay.remove();
      if (actionBar) actionBar.remove();

      // Reset sidebar state
      var sidebar = document.querySelector('.sidebar, nav.sidebar, aside.sidebar, [class*="sidebar"]');
      if (sidebar) {
        sidebar.classList.remove('ux-mobile-open');
      }
      document.body.style.overflow = '';

      // Reinitialize if now mobile
      if (isMobile) {
        setupMobileSidebar();
        setupMobileSearch();
        setupMobileActionBar();
      }
    }
  });

  // ─── Initialize all enhancements after DOM ready ──────────────────────────
  function init() {
    setupValidation();
    setupTagAutocomplete();
    setupEmptySearchState();
    startTour();
    setupUserChip();
    setupMyMemoriesToggle();
    setupPermissionGuards();
    applyOwnershipUI();
    setupOwnershipObserver();

    // Mobile enhancements
    isMobile = window.innerWidth <= 768;
    if (isMobile) {
      setupMobileSidebar();
      setupMobileSearch();
      setupMobileActionBar();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
