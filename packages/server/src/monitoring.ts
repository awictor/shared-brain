import type { Application, Request, Response, NextFunction } from 'express';
import { existsSync, statSync } from 'fs';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MetricSnapshot {
  requests_per_minute: number;
  avg_response_ms: number;
  memory_count: number;
  vector_index_size: number;
  error_count: number;
  active_users: number;
  heap_used_mb: number;
  uptime_seconds: number;
  timestamp: string;
}

interface Alert {
  id: string;
  severity: 'warning' | 'critical';
  message: string;
  metric: string;
  threshold: number;
  actual: number;
  triggeredAt: string;
}

interface HistoryDataPoint {
  timestamp: string;
  requests: number;
  responseTime: number;
  errors: number;
  activeUsers: number;
  heapMb: number;
}

// ─── MetricsCollector (in-memory ring buffer, 24h window) ──────────────────────

class MetricsCollector {
  private requestCount = 0;
  private errorCount = 0;
  private responseTimes: number[] = [];
  private activeUsers = new Set<string>();
  private lastMinuteRequests = 0;
  private lastMinuteErrors = 0;
  private lastMinuteAvgResponseMs = 0;
  private lastMinuteTick = Date.now();

  // Ring buffer: store 24h of minute-by-minute samples (1440 entries)
  private history: HistoryDataPoint[] = [];
  private readonly maxHistorySize = 1440; // 24h * 60min

  private memoryCount = 0;
  private vectorIndexSize = 0;

  private startTime = Date.now();

  constructor() {
    // Sample metrics every minute
    setInterval(() => this.sampleMetrics(), 60_000);

    // Cleanup stale user IDs every 5 minutes
    setInterval(() => this.cleanupStaleUsers(), 300_000);
  }

  recordRequest(userId: string, responseTimeMs: number, statusCode: number): void {
    this.requestCount++;
    this.responseTimes.push(responseTimeMs);
    this.activeUsers.add(userId);

    if (statusCode >= 400) {
      this.errorCount++;
    }
  }

  updateMemoryCount(count: number): void {
    this.memoryCount = count;
  }

  updateVectorIndexSize(size: number): void {
    this.vectorIndexSize = size;
  }

  private sampleMetrics(): void {
    const now = Date.now();
    const elapsedMinutes = (now - this.lastMinuteTick) / 60_000;

    // Calculate per-minute rates
    this.lastMinuteRequests = Math.round(this.requestCount / elapsedMinutes);
    this.lastMinuteErrors = Math.round(this.errorCount / elapsedMinutes);

    // Calculate average response time
    if (this.responseTimes.length > 0) {
      const sum = this.responseTimes.reduce((a, b) => a + b, 0);
      this.lastMinuteAvgResponseMs = Math.round(sum / this.responseTimes.length);
    } else {
      this.lastMinuteAvgResponseMs = 0;
    }

    // Store in history
    this.history.push({
      timestamp: new Date().toISOString(),
      requests: this.lastMinuteRequests,
      responseTime: this.lastMinuteAvgResponseMs,
      errors: this.lastMinuteErrors,
      activeUsers: this.activeUsers.size,
      heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    });

    // Keep only last 24h
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    // Reset counters
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimes = [];
    this.lastMinuteTick = now;
  }

  private cleanupStaleUsers(): void {
    // In a real system, track last-seen per user and remove after 5min inactivity
    // For now, just clear the set periodically (users are re-added on next request)
    this.activeUsers.clear();
  }

  getSnapshot(): MetricSnapshot {
    const memUsage = process.memoryUsage();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      requests_per_minute: this.lastMinuteRequests,
      avg_response_ms: this.lastMinuteAvgResponseMs,
      memory_count: this.memoryCount,
      vector_index_size: this.vectorIndexSize,
      error_count: this.lastMinuteErrors,
      active_users: this.activeUsers.size,
      heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
      uptime_seconds: uptimeSeconds,
      timestamp: new Date().toISOString(),
    };
  }

  getHistory(): HistoryDataPoint[] {
    return this.history;
  }

  checkAlerts(dbPath: string): Alert[] {
    const alerts: Alert[] = [];
    const snapshot = this.getSnapshot();

    // Alert: error rate > 10% in last minute
    if (snapshot.requests_per_minute > 0) {
      const errorRate = snapshot.error_count / snapshot.requests_per_minute;
      if (errorRate > 0.1) {
        alerts.push({
          id: 'error-rate',
          severity: 'critical',
          message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
          metric: 'error_rate',
          threshold: 0.1,
          actual: errorRate,
          triggeredAt: new Date().toISOString(),
        });
      }
    }

    // Alert: avg response time > 2000ms
    if (snapshot.avg_response_ms > 2000) {
      alerts.push({
        id: 'slow-response',
        severity: 'warning',
        message: `Slow response times: ${snapshot.avg_response_ms}ms average`,
        metric: 'avg_response_ms',
        threshold: 2000,
        actual: snapshot.avg_response_ms,
        triggeredAt: new Date().toISOString(),
      });
    }

    // Alert: heap memory > 512MB
    if (snapshot.heap_used_mb > 512) {
      alerts.push({
        id: 'high-memory',
        severity: 'warning',
        message: `High memory usage: ${snapshot.heap_used_mb}MB heap`,
        metric: 'heap_used_mb',
        threshold: 512,
        actual: snapshot.heap_used_mb,
        triggeredAt: new Date().toISOString(),
      });
    }

    // Alert: disk usage > 90% (check DB file size vs 1GB limit as proxy)
    try {
      if (existsSync(dbPath)) {
        const stats = statSync(dbPath);
        const sizeMb = Math.round(stats.size / 1024 / 1024);
        const limitMb = 1024; // 1GB limit
        const usage = sizeMb / limitMb;

        if (usage > 0.9) {
          alerts.push({
            id: 'disk-usage',
            severity: 'critical',
            message: `High disk usage: ${sizeMb}MB / ${limitMb}MB (${(usage * 100).toFixed(1)}%)`,
            metric: 'disk_usage',
            threshold: 0.9,
            actual: usage,
            triggeredAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      // Ignore disk check errors
    }

    return alerts;
  }
}

// ─── Monitoring Middleware ──────────────────────────────────────────────────────

function createMonitoringMiddleware(collector: MetricsCollector) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const userId = (req as any).userId ?? 'anonymous';

    // Intercept response finish to record metrics
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      collector.recordRequest(userId, responseTime, res.statusCode);
    });

    next();
  };
}

// ─── Dashboard HTML ────────────────────────────────────────────────────────────

function renderDashboard(snapshot: MetricSnapshot, alerts: Alert[]): string {
  const uptimeHours = Math.floor(snapshot.uptime_seconds / 3600);
  const uptimeMins = Math.floor((snapshot.uptime_seconds % 3600) / 60);
  const uptimeSecs = snapshot.uptime_seconds % 60;
  const uptimeStr = `${uptimeHours}h ${uptimeMins}m ${uptimeSecs}s`;

  const errorRatePercent = snapshot.requests_per_minute > 0
    ? ((snapshot.error_count / snapshot.requests_per_minute) * 100).toFixed(1)
    : '0.0';

  const errorRateColor = parseFloat(errorRatePercent) > 10 ? '#ef4444' : parseFloat(errorRatePercent) > 5 ? '#f59e0b' : '#10b981';

  const alertBanner = alerts.length > 0 ? `
    <div class="alert-banner">
      <strong>⚠️ ${alerts.length} Active Alert${alerts.length > 1 ? 's' : ''}</strong>
      ${alerts.map(a => `<div class="alert ${a.severity}">${a.message}</div>`).join('')}
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SharedBrain Monitoring</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: #f8fafc;
    }
    .subtitle {
      font-size: 0.875rem;
      color: #94a3b8;
      margin-bottom: 2rem;
    }
    .alert-banner {
      background: #7c2d12;
      border: 2px solid #dc2626;
      border-radius: 0.5rem;
      padding: 1rem;
      margin-bottom: 2rem;
    }
    .alert-banner strong {
      display: block;
      margin-bottom: 0.5rem;
      color: #fef2f2;
    }
    .alert {
      font-size: 0.875rem;
      margin-top: 0.25rem;
      padding: 0.5rem;
      border-radius: 0.25rem;
      background: rgba(0, 0, 0, 0.2);
    }
    .alert.warning { border-left: 3px solid #f59e0b; }
    .alert.critical { border-left: 3px solid #dc2626; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .card {
      background: #1e293b;
      border-radius: 0.75rem;
      padding: 1.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .card-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .metric-value {
      font-size: 2.5rem;
      font-weight: 700;
      color: #f8fafc;
      line-height: 1;
    }
    .metric-unit {
      font-size: 1rem;
      color: #64748b;
      margin-left: 0.5rem;
    }
    .sparkline {
      height: 60px;
      margin-top: 1rem;
      position: relative;
      background: #0f172a;
      border-radius: 0.25rem;
      overflow: hidden;
    }
    .sparkline-bar {
      position: absolute;
      bottom: 0;
      width: 1.5%;
      background: linear-gradient(to top, #3b82f6, #60a5fa);
      border-radius: 2px 2px 0 0;
      transition: height 0.3s ease;
    }
    .gauge {
      margin-top: 1rem;
      height: 12px;
      background: #0f172a;
      border-radius: 6px;
      overflow: hidden;
      position: relative;
    }
    .gauge-fill {
      height: 100%;
      background: linear-gradient(to right, #10b981, #f59e0b, #ef4444);
      border-radius: 6px;
      transition: width 0.3s ease;
    }
    .gauge-label {
      font-size: 0.75rem;
      color: #64748b;
      margin-top: 0.5rem;
    }
    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      margin-right: 0.5rem;
      animation: pulse 2s ease-in-out infinite;
    }
    .status-green { background: #10b981; }
    .status-yellow { background: #f59e0b; }
    .status-red { background: #ef4444; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .footer {
      text-align: center;
      margin-top: 3rem;
      font-size: 0.75rem;
      color: #475569;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>SharedBrain Monitoring</h1>
    <div class="subtitle">Real-time server health metrics • Auto-refresh every 10s</div>

    ${alertBanner}

    <div class="grid">
      <div class="card">
        <div class="card-title">Requests / Minute</div>
        <div class="metric-value">${snapshot.requests_per_minute}<span class="metric-unit">req/min</span></div>
        <div class="sparkline" id="sparkline-requests"></div>
      </div>

      <div class="card">
        <div class="card-title">Response Time</div>
        <div class="metric-value">${snapshot.avg_response_ms}<span class="metric-unit">ms</span></div>
        <div class="sparkline" id="sparkline-response"></div>
      </div>

      <div class="card">
        <div class="card-title">Error Rate</div>
        <div class="metric-value" style="color: ${errorRateColor}">${errorRatePercent}<span class="metric-unit">%</span></div>
        <div style="margin-top: 1rem; font-size: 0.875rem; color: #64748b;">
          <span class="status-indicator status-${errorRatePercent === '0.0' ? 'green' : parseFloat(errorRatePercent) < 10 ? 'yellow' : 'red'}"></span>
          ${snapshot.error_count} errors in last minute
        </div>
      </div>

      <div class="card">
        <div class="card-title">Active Users</div>
        <div class="metric-value">${snapshot.active_users}<span class="metric-unit">users</span></div>
        <div style="margin-top: 1rem; font-size: 0.875rem; color: #64748b;">
          Last 5 minutes
        </div>
      </div>

      <div class="card">
        <div class="card-title">Memory Usage</div>
        <div class="metric-value">${snapshot.heap_used_mb}<span class="metric-unit">MB</span></div>
        <div class="gauge">
          <div class="gauge-fill" style="width: ${Math.min((snapshot.heap_used_mb / 512) * 100, 100)}%"></div>
        </div>
        <div class="gauge-label">Heap: ${snapshot.heap_used_mb} / 512 MB</div>
      </div>

      <div class="card">
        <div class="card-title">Memory Count</div>
        <div class="metric-value">${snapshot.memory_count.toLocaleString()}<span class="metric-unit">items</span></div>
        <div style="margin-top: 1rem; font-size: 0.875rem; color: #64748b;">
          Vector index: ${snapshot.vector_index_size.toLocaleString()} vectors
        </div>
      </div>

      <div class="card">
        <div class="card-title">Uptime</div>
        <div class="metric-value" style="font-size: 1.75rem;">${uptimeStr}</div>
        <div style="margin-top: 1rem; font-size: 0.875rem; color: #64748b;">
          <span class="status-indicator status-green"></span>
          Server running normally
        </div>
      </div>
    </div>

    <div class="footer">
      SharedBrain Monitoring Dashboard • Last updated: ${new Date(snapshot.timestamp).toLocaleString()}
    </div>
  </div>

  <script>
    // Auto-refresh every 10 seconds
    setTimeout(() => location.reload(), 10000);

    // Fetch history and render sparklines
    fetch('/api/metrics/history')
      .then(r => r.json())
      .then(data => {
        renderSparkline('sparkline-requests', data.history.map(d => d.requests));
        renderSparkline('sparkline-response', data.history.map(d => d.responseTime));
      });

    function renderSparkline(id, values) {
      const container = document.getElementById(id);
      if (!container || values.length === 0) return;

      // Take last 60 data points
      const recentValues = values.slice(-60);
      const max = Math.max(...recentValues, 1);

      container.innerHTML = '';
      recentValues.forEach((value, i) => {
        const bar = document.createElement('div');
        bar.className = 'sparkline-bar';
        bar.style.left = (i * 1.67) + '%';
        bar.style.height = ((value / max) * 100) + '%';
        container.appendChild(bar);
      });
    }
  </script>
</body>
</html>`;
}

// ─── Register Monitoring Routes ────────────────────────────────────────────────

export function registerMonitoring(app: Application, dbPath?: string): MetricsCollector {
  const collector = new MetricsCollector();
  const resolvedDbPath = dbPath ?? 'C:/Users/awictor/shared-brain/data/brain.db';

  // Apply monitoring middleware to all routes
  app.use(createMonitoringMiddleware(collector));

  // API endpoint: current snapshot
  app.get('/api/metrics', (_req, res) => {
    const snapshot = collector.getSnapshot();
    res.json(snapshot);
  });

  // API endpoint: 24h history
  app.get('/api/metrics/history', (_req, res) => {
    const history = collector.getHistory();
    res.json({ history });
  });

  // API endpoint: active alerts
  app.get('/api/metrics/alerts', (_req, res) => {
    const alerts = collector.checkAlerts(resolvedDbPath);
    res.json({ alerts });
  });

  // Dashboard UI
  app.get('/monitoring', (_req, res) => {
    const snapshot = collector.getSnapshot();
    const alerts = collector.checkAlerts(resolvedDbPath);
    const html = renderDashboard(snapshot, alerts);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });

  // Return collector so index.ts can update memory/vector stats
  return collector;
}
