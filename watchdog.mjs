#!/usr/bin/env node
/**
 * SharedBrain Watchdog — keeps the server running 24/7.
 * Restarts automatically on crash. Checks health every 30s.
 */

import { spawn } from 'child_process';
import { resolve } from 'path';

const SERVER_SCRIPT = resolve('C:/Users/awictor/shared-brain/packages/server/dist/index.js');
const HEALTH_URL = 'http://127.0.0.1:3100/health';
const CHECK_INTERVAL = 30_000; // 30 seconds
const RESTART_DELAY = 3_000;   // 3 seconds before restart

let serverProcess = null;
let restartCount = 0;

function startServer() {
  console.log(`[watchdog] Starting SharedBrain server... (restart #${restartCount})`);

  serverProcess = spawn('node', [SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '3100', HOST: '0.0.0.0', DB_PATH: 'C:/Users/awictor/shared-brain/data/brain.db' },
  });

  serverProcess.stdout.on('data', (d) => process.stdout.write(d));
  serverProcess.stderr.on('data', (d) => process.stderr.write(d));

  serverProcess.on('exit', (code) => {
    console.error(`[watchdog] Server exited with code ${code}. Restarting in ${RESTART_DELAY/1000}s...`);
    serverProcess = null;
    restartCount++;
    setTimeout(startServer, RESTART_DELAY);
  });
}

async function healthCheck() {
  try {
    const resp = await fetch(HEALTH_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  } catch {
    if (serverProcess) {
      console.error('[watchdog] Health check failed — server unresponsive. Killing and restarting...');
      serverProcess.kill('SIGTERM');
    } else {
      console.error('[watchdog] Server not running. Starting...');
      startServer();
    }
  }
}

// Start server
startServer();

// Health check every 30s
setInterval(healthCheck, CHECK_INTERVAL);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('[watchdog] Shutting down...');
  if (serverProcess) serverProcess.kill();
  process.exit(0);
});
