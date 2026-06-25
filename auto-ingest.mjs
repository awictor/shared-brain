#!/usr/bin/env node
/**
 * SharedBrain Auto-Ingest — Stop Hook
 *
 * Runs at the end of every Claude Code conversation.
 * Reads the session transcript, extracts meaningful content
 * (decisions, facts, procedures, action items), and POSTs
 * them to the shared brain's ingest endpoint.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Point at the live remote brain by default; override with BRAIN_INGEST_URL for local dev.
const BRAIN_URL = process.env.BRAIN_INGEST_URL ?? 'https://agenticmarketing.sps.amazon.dev/brain/ingest/generic';
const INGEST_TOKEN = process.env.INGEST_TOKEN ?? 'dev-ingest-token';
const CACHE_DIR = join(homedir(), 'AppData', 'Local', 'claude-cli-nodejs', 'Cache', 'C--Users-awictor');

// Patterns that indicate meaningful content worth remembering
const SIGNAL_PATTERNS = [
  /\b(decided|decision|we chose|agreed to|committed to)\b/i,
  /\b(action item|todo|TODO|next step|follow.?up)\b/i,
  /\b(always|never|rule|policy|standard|guideline)\b/i,
  /\b(learned|discovered|found out|turns out|realized)\b/i,
  /\b(installed|configured|deployed|set up|created|built)\b/i,
  /\b(password|key|token|secret|credential|endpoint|url)\b/i,
  /\b(bug|fix|workaround|solution|resolved)\b/i,
  /\b(architecture|design|pattern|approach|strategy)\b/i,
];

// Skip noise
const NOISE_PATTERNS = [
  /^(ok|yes|no|sure|thanks|got it|sounds good)/i,
  /^(let me|I'll|I will|I can)/i,
  /^(here's|here is) (the|a|an)/i,
  /reading file|searching|checking/i,
];

function isSignal(text) {
  if (text.length < 30 || text.length > 2000) return false;
  if (NOISE_PATTERNS.some(p => p.test(text))) return false;
  return SIGNAL_PATTERNS.some(p => p.test(text));
}

function extractType(text) {
  if (/decided|decision|chose|agreed/i.test(text)) return 'decision';
  if (/action item|todo|next step/i.test(text)) return 'procedure';
  if (/always|never|rule|policy/i.test(text)) return 'preference';
  if (/bug|fix|workaround|resolved/i.test(text)) return 'context';
  return 'fact';
}

async function ingest(content, metadata = {}) {
  try {
    const resp = await fetch(BRAIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ingest-Token': INGEST_TOKEN,
      },
      body: JSON.stringify({
        content,
        source: 'auto-ingest-hook',
        metadata: { ...metadata, timestamp: new Date().toISOString() },
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.stored) process.stderr.write(`[brain] Stored: ${content.substring(0, 60)}...\n`);
    }
  } catch (err) {
    process.stderr.write(`[brain] WARNING: SharedBrain ingest endpoint not reachable at ${BRAIN_URL} — memories are NOT being saved. Check network/VPN, or set BRAIN_INGEST_URL for local dev.\n`);
  }
}

async function main() {
  try {
    // Find the most recent session transcript
    const sessionDirs = readdirSync(CACHE_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.startsWith('sessions'))
      .map(d => join(CACHE_DIR, d.name));

    if (!sessionDirs.length) return;

    const sessDir = sessionDirs[0];
    const files = readdirSync(sessDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, path: join(sessDir, f), mtime: readFileSync(join(sessDir, f)).length }))
      .sort((a, b) => b.mtime - a.mtime);

    if (!files.length) return;

    // Read the most recent transcript
    const transcript = readFileSync(files[0].path, 'utf8');
    const lines = transcript.split('\n').filter(Boolean);

    // Extract assistant messages
    const memories = [];
    for (const line of lines.slice(-100)) { // Last 100 entries
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'assistant' && entry.content) {
          const text = typeof entry.content === 'string'
            ? entry.content
            : entry.content.filter(c => c.type === 'text').map(c => c.text).join(' ');

          // Split into sentences and check each
          const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(Boolean);
          for (const sentence of sentences) {
            if (isSignal(sentence) && !memories.some(m => m.content === sentence)) {
              memories.push({ content: sentence, type: extractType(sentence) });
            }
          }
        }
      } catch { /* skip malformed lines */ }
    }

    // Ingest top 5 most meaningful extractions
    const toIngest = memories.slice(0, 5);
    for (const mem of toIngest) {
      await ingest(mem.content, { type: mem.type, source: 'conversation-auto-extract' });
    }

    if (toIngest.length > 0) {
      process.stderr.write(`[brain] Auto-ingested ${toIngest.length} memories from this session.\n`);
    }
  } catch (err) {
    process.stderr.write(`[brain] Auto-ingest error: ${err.message}\n`);
  }
}

main();
