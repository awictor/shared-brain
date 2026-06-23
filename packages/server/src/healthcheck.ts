/**
 * Health check endpoints for cloud deployment.
 * - /health/ready — 200 when ONNX model loaded (for ALB health checks)
 * - /health/deep — verifies DB writable, embeddings functional, vector index populated
 * - /health/metrics — operational stats
 */

import type { Application } from 'express';
import type { Store, Embeddings, VectorIndex } from './mcp/handler.js';

export interface HealthDeps {
  store: Store & { db?: any };
  embeddings: Embeddings & { extractor?: any };
  vectorIndex: VectorIndex;
}

// Simple request counter (reset daily)
let requestsToday = 0;
let responseMsAccum = 0;
let responseMsCount = 0;
let lastResetDate = new Date().toDateString();

const startTime = Date.now();

export function registerHealthChecks(app: Application, deps: HealthDeps): void {
  const { store, embeddings, vectorIndex } = deps;

  // Track requests for metrics
  app.use((_req, _res, next) => {
    const today = new Date().toDateString();
    if (today !== lastResetDate) {
      requestsToday = 0;
      responseMsAccum = 0;
      responseMsCount = 0;
      lastResetDate = today;
    }
    requestsToday++;
    const start = Date.now();
    _res.on('finish', () => {
      responseMsAccum += Date.now() - start;
      responseMsCount++;
    });
    next();
  });

  // GET /health/ready — 200 only when ONNX model fully loaded
  app.get('/health/ready', (_req, res) => {
    const isReady = !!(embeddings as any).extractor;
    if (isReady) {
      res.status(200).json({ status: 'ready', model: 'Xenova/all-MiniLM-L6-v2' });
    } else {
      res.status(503).json({ status: 'loading', message: 'ONNX model not yet loaded' });
    }
  });

  // GET /health/deep — checks DB writable, embeddings work, vector index populated
  app.get('/health/deep', async (_req, res) => {
    const checks: Record<string, { ok: boolean; detail?: string }> = {};

    // DB writable check
    try {
      const db = (store as any).db;
      if (!db) throw new Error('DB not initialized');
      db.run("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('_healthcheck', ?)", [new Date().toISOString()]);
      db.run("DELETE FROM sync_state WHERE key = '_healthcheck'");
      checks.database = { ok: true };
    } catch (err: any) {
      checks.database = { ok: false, detail: err.message };
    }

    // Embeddings check
    try {
      const vec = await embeddings.embed('health check');
      if (vec.length !== embeddings.getDimensions()) throw new Error(`Unexpected dimensions: ${vec.length}`);
      checks.embeddings = { ok: true, detail: `${vec.length}-dim` };
    } catch (err: any) {
      checks.embeddings = { ok: false, detail: err.message };
    }

    // Vector index populated check
    try {
      const size = vectorIndex.size();
      checks.vector_index = { ok: size > 0, detail: `${size} vectors` };
    } catch (err: any) {
      checks.vector_index = { ok: false, detail: err.message };
    }

    const allOk = Object.values(checks).every(c => c.ok);
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'healthy' : 'degraded', checks });
  });

  // GET /health/metrics — operational stats
  app.get('/health/metrics', async (_req, res) => {
    const memoryCount = await store.countMemories();
    const vectorCount = vectorIndex.size();
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const avgResponseMs = responseMsCount > 0 ? Math.round(responseMsAccum / responseMsCount) : 0;

    res.json({
      memory_count: memoryCount,
      vector_count: vectorCount,
      uptime_seconds: uptimeSeconds,
      requests_today: requestsToday,
      avg_response_ms: avgResponseMs,
    });
  });
}
