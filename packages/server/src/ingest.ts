/**
 * IngestEngine — passive ingestion connectors for SharedBrain.
 *
 * Exposes webhook endpoints that external tools POST to (Slack events, email JSON,
 * meeting notes, generic payloads). Processes content, deduplicates via embedding
 * similarity, and stores as memories automatically.
 */

import { randomUUID } from 'node:crypto';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, NextFunction, Application } from 'express';
import type { Store, Embeddings, VectorIndex, Memory, MemoryOperation } from './mcp/handler.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface IngestConfig {
  token: string;
  minContentLength: number;   // Skip messages shorter than this (default: 20)
  deduplicateThreshold: number; // Skip if similarity > this (default: 0.85)
}

export interface SlackEvent {
  type?: string;          // 'message', 'message_changed', etc.
  channel: string;        // Channel name or ID
  channel_name?: string;  // Human-readable channel name
  user: string;           // User ID or name
  user_name?: string;     // Display name
  text: string;           // Message text
  ts: string;             // Slack timestamp
  thread_ts?: string;     // Thread parent timestamp
}

export interface EmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  body: string;
  date: string;
  cc?: string | string[];
  thread_id?: string;
}

export interface MeetingPayload {
  title: string;
  attendees: string[];
  date: string;
  notes: string;
  action_items?: string[];
  duration_minutes?: number;
}

export interface GenericPayload {
  content: string;
  source: string;
  metadata?: Record<string, unknown>;
  title?: string;
  tags?: string[];
}

export interface IngestResult {
  stored: boolean;
  memoryId?: string;
  memoryIds?: string[];
  reason?: string;
}

interface IngestLogEntry {
  id: string;
  timestamp: string;
  source: string;
  sourceDetail: string;
  stored: boolean;
  memoryId?: string;
  memoryIds?: string[];
  reason?: string;
}

// ─── Content extraction heuristics ──────────────────────────────────────────────

const SIGNAL_PATTERNS = [
  /\bdecided\b/i,
  /\baction item\b/i,
  /\bTODO\b/,
  /\bagreed\b/i,
  /\bdeadline\b/i,
  /\bblocked\b/i,
  /\bowner\b/i,
  /\bnext step/i,
  /\bfollow[- ]?up\b/i,
  /\bshipped\b/i,
  /\blaunched\b/i,
  /\bapproved\b/i,
  /\brejected\b/i,
  /@\w+/,
];

const NOISE_PATTERNS = [
  /^(ok|okay|thanks|thank you|thx|ty|lgtm|sounds good|got it|np|sure|yep|yes|no|nope|k|kk|👍|✅|done)$/i,
];

function isNoise(text: string): boolean {
  const trimmed = text.trim();
  return NOISE_PATTERNS.some((p) => p.test(trimmed));
}

function hasSignal(text: string): boolean {
  return SIGNAL_PATTERNS.some((p) => p.test(text));
}

function extractKeyFacts(text: string): string[] {
  const sentences = text.split(/[.!?\n]+/).map((s) => s.trim()).filter(Boolean);
  return sentences.filter((s) => hasSignal(s));
}

// ─── Auth middleware for ingest routes ──────────────────────────────────────────

function ingestAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.headers['x-ingest-token'] as string | undefined
      ?? req.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (!provided) {
      res.status(401).json({ error: 'Missing X-Ingest-Token header' });
      return;
    }

    const expected = Buffer.from(createHash('sha256').update(token).digest());
    const actual = Buffer.from(createHash('sha256').update(provided).digest());

    if (!timingSafeEqual(expected, actual)) {
      res.status(403).json({ error: 'Invalid ingest token' });
      return;
    }

    next();
  };
}

// ─── IngestEngine ───────────────────────────────────────────────────────────────

const LOCAL_USER_ID = 'ingest';
const LOCAL_USER_NAME = 'Ingest Engine';

export class IngestEngine {
  private log: IngestLogEntry[] = [];
  private readonly maxLogEntries = 500;

  constructor(
    private store: Store,
    private embeddings: Embeddings,
    private vectorIndex: VectorIndex,
    private config: IngestConfig,
  ) {}

  /**
   * Register all /ingest/* routes on the Express app.
   */
  registerRoutes(app: Application): void {
    const auth = ingestAuth(this.config.token);

    app.post('/ingest/slack', auth, async (req, res) => {
      try {
        // Slack URL verification challenge
        if (req.body?.challenge) {
          res.json({ challenge: req.body.challenge });
          return;
        }
        const event: SlackEvent = req.body?.event ?? req.body;
        const result = await this.processSlackEvent(event);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/ingest/email', auth, async (req, res) => {
      try {
        const result = await this.processEmail(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/ingest/meeting', auth, async (req, res) => {
      try {
        const result = await this.processMeeting(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/ingest/generic', auth, async (req, res) => {
      try {
        const result = await this.processGeneric(req.body);
        res.json(result);
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    app.post('/ingest/batch', auth, async (req, res) => {
      try {
        const items: Array<{ type: string; payload: any }> = req.body?.items ?? req.body;
        if (!Array.isArray(items)) {
          res.status(400).json({ error: 'Expected { items: [...] } array' });
          return;
        }
        if (items.length > 100) {
          res.status(429).json({ error: 'Max 100 items per batch request' });
          return;
        }

        const results: IngestResult[] = [];
        for (const item of items) {
          let result: IngestResult;
          switch (item.type) {
            case 'slack':
              result = await this.processSlackEvent(item.payload);
              break;
            case 'email':
              result = await this.processEmail(item.payload);
              break;
            case 'meeting':
              result = await this.processMeeting(item.payload);
              break;
            case 'generic':
            default:
              result = await this.processGeneric(item.payload);
              break;
          }
          results.push(result);
        }

        const stored = results.filter((r) => r.stored).length;
        const skipped = results.filter((r) => !r.stored).length;
        res.json({ total: items.length, stored, skipped, results });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    });

    // Ingest log endpoint (no auth required — read-only diagnostics)
    app.get('/ingest/log', (_req, res) => {
      const limit = Math.min(parseInt(_req.query['limit'] as string) || 50, 200);
      const entries = this.log.slice(-limit).reverse();
      res.json({ entries, total: this.log.length });
    });
  }

  /**
   * Process a Slack message event.
   */
  async processSlackEvent(event: SlackEvent): Promise<IngestResult> {
    if (!event || !event.text) {
      return this.logAndReturn('slack', event?.channel ?? 'unknown', false, undefined, 'No text content');
    }

    const text = event.text.trim();

    // Skip noise
    if (text.length < this.config.minContentLength) {
      return this.logAndReturn('slack', event.channel, false, undefined, `Too short (${text.length} chars)`);
    }
    if (isNoise(text)) {
      return this.logAndReturn('slack', event.channel, false, undefined, 'Noise/greeting detected');
    }

    const channelName = event.channel_name ?? event.channel;
    const userName = event.user_name ?? event.user;
    const title = `Slack: #${channelName} — ${userName}`;

    // Check for duplicates
    const isDup = await this.isDuplicate(text);
    if (isDup) {
      return this.logAndReturn('slack', channelName, false, undefined, 'Duplicate content (similarity > threshold)');
    }

    // Build content with context
    const keyFacts = extractKeyFacts(text);
    const content = keyFacts.length > 0
      ? `[Key facts from #${channelName}]\n${keyFacts.join('\n')}\n\n[Full message]\n${text}`
      : text;

    // Auto-tags
    const tags = ['ingest:slack', `channel:${channelName}`];
    if (event.thread_ts) tags.push('threaded');
    if (hasSignal(text)) tags.push('has-signal');

    const memoryId = await this.storeMemory({
      content,
      title,
      type: hasSignal(text) ? 'decision' : 'context',
      tags,
      source: { type: 'slack', agent: 'ingest-engine', reference: `slack://${event.channel}/${event.ts}` },
    });

    return this.logAndReturn('slack', channelName, true, memoryId);
  }

  /**
   * Process an email payload.
   */
  async processEmail(email: EmailPayload): Promise<IngestResult> {
    if (!email || !email.body) {
      return this.logAndReturn('email', email?.subject ?? 'unknown', false, undefined, 'No body content');
    }

    const body = email.body.trim();

    if (body.length < this.config.minContentLength) {
      return this.logAndReturn('email', email.subject, false, undefined, `Too short (${body.length} chars)`);
    }

    // Check for duplicates
    const isDup = await this.isDuplicate(`${email.subject} ${body}`);
    if (isDup) {
      return this.logAndReturn('email', email.subject, false, undefined, 'Duplicate content');
    }

    const to = Array.isArray(email.to) ? email.to.join(', ') : email.to;
    const title = `Email: ${email.subject}`;
    const keyFacts = extractKeyFacts(body);

    const content = [
      `From: ${email.from}`,
      `To: ${to}`,
      `Subject: ${email.subject}`,
      `Date: ${email.date}`,
      '',
      keyFacts.length > 0 ? `[Key points]\n${keyFacts.join('\n')}\n\n[Full body]` : '',
      body,
    ].filter(Boolean).join('\n');

    const tags = ['ingest:email'];
    if (hasSignal(body)) tags.push('has-signal');
    if (email.thread_id) tags.push(`thread:${email.thread_id}`);

    const memoryId = await this.storeMemory({
      content,
      title,
      type: hasSignal(body) ? 'decision' : 'context',
      tags,
      source: { type: 'email', agent: 'ingest-engine', reference: email.thread_id ?? null },
    });

    return this.logAndReturn('email', email.subject, true, memoryId);
  }

  /**
   * Process meeting notes — may produce multiple memories (one for notes + one per action item).
   */
  async processMeeting(meeting: MeetingPayload): Promise<{ stored: boolean; memoryIds: string[] }> {
    if (!meeting || !meeting.notes) {
      this.addLogEntry('meeting', meeting?.title ?? 'unknown', false, undefined, undefined, 'No notes content');
      return { stored: false, memoryIds: [] };
    }

    const memoryIds: string[] = [];
    const title = `Meeting: ${meeting.title}`;
    const attendeeStr = meeting.attendees.join(', ');

    // Store main notes
    const notesContent = [
      `Meeting: ${meeting.title}`,
      `Date: ${meeting.date}`,
      `Attendees: ${attendeeStr}`,
      meeting.duration_minutes ? `Duration: ${meeting.duration_minutes} min` : '',
      '',
      meeting.notes,
    ].filter(Boolean).join('\n');

    const tags = ['ingest:meeting', `meeting:${meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`];

    const isDup = await this.isDuplicate(notesContent);
    if (!isDup) {
      const notesId = await this.storeMemory({
        content: notesContent,
        title,
        type: 'context',
        tags,
        source: { type: 'meeting', agent: 'ingest-engine', reference: null },
      });
      memoryIds.push(notesId);
    }

    // Store each action item as a separate memory
    if (meeting.action_items?.length) {
      for (const item of meeting.action_items) {
        if (item.trim().length < 5) continue;

        const actionContent = `[Action Item from "${meeting.title}" on ${meeting.date}]\n${item}\nAttendees: ${attendeeStr}`;
        const actionDup = await this.isDuplicate(actionContent);
        if (actionDup) continue;

        const actionId = await this.storeMemory({
          content: actionContent,
          title: `Action: ${item.slice(0, 60)}`,
          type: 'decision',
          tags: [...tags, 'action-item'],
          source: { type: 'meeting', agent: 'ingest-engine', reference: null },
        });
        memoryIds.push(actionId);
      }
    }

    this.addLogEntry('meeting', meeting.title, memoryIds.length > 0, undefined, memoryIds,
      memoryIds.length === 0 ? 'All content duplicate' : undefined);

    return { stored: memoryIds.length > 0, memoryIds };
  }

  /**
   * Process a generic payload.
   */
  async processGeneric(payload: GenericPayload): Promise<IngestResult> {
    if (!payload || !payload.content) {
      return this.logAndReturn('generic', payload?.source ?? 'unknown', false, undefined, 'No content');
    }

    const content = payload.content.trim();

    if (content.length < this.config.minContentLength) {
      return this.logAndReturn('generic', payload.source, false, undefined, `Too short (${content.length} chars)`);
    }

    const isDup = await this.isDuplicate(content);
    if (isDup) {
      return this.logAndReturn('generic', payload.source, false, undefined, 'Duplicate content');
    }

    const title = payload.title ?? `Ingested: ${payload.source}`;
    const tags = ['ingest:generic', `source:${payload.source}`, ...(payload.tags ?? [])];

    const memoryId = await this.storeMemory({
      content,
      title,
      type: hasSignal(content) ? 'decision' : 'context',
      tags,
      source: { type: payload.source, agent: 'ingest-engine', reference: null },
    });

    return this.logAndReturn('generic', payload.source, true, memoryId);
  }

  /**
   * Get the recent ingest log.
   */
  getLog(limit: number = 50): IngestLogEntry[] {
    return this.log.slice(-limit).reverse();
  }

  /**
   * Record a memory that was stored directly via the MCP memory_store tool
   * (not through a webhook). Lets the Ingestion Log reflect all memory
   * activity, not just passive webhook traffic.
   */
  recordStore(detail: { memoryId: string; title?: string | null; type?: string }): void {
    this.addLogEntry(
      'memory_store',
      detail.title || detail.type || detail.memoryId,
      true,
      detail.memoryId,
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private async isDuplicate(text: string): Promise<boolean> {
    try {
      const embedding = await this.embeddings.embed(text);
      const results = this.vectorIndex.search(embedding, 1, this.config.deduplicateThreshold);
      return results.length > 0;
    } catch {
      return false;
    }
  }

  private async storeMemory(params: {
    content: string;
    title: string;
    type: string;
    tags: string[];
    source: { type: string; agent: string; reference: string | null };
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const hlc = `${Date.now()}:0000:${LOCAL_USER_ID}`;

    const embedding = await this.embeddings.embed(params.content);

    const memory: Memory = {
      id,
      content: params.content,
      title: params.title,
      type: params.type as any,
      scope: 'personal',
      teamId: null,
      orgId: null,
      authorId: LOCAL_USER_ID,
      authorName: LOCAL_USER_NAME,
      tags: params.tags,
      embedding,
      hlc,
      deleted: false,
      createdAt: now,
      updatedAt: now,
      source: params.source,
      relations: [],
      version: 1,
    };

    await this.store.createMemory(memory);
    this.vectorIndex.add(id, embedding);

    // Log operation for sync
    const op: MemoryOperation = {
      id: randomUUID(),
      memoryId: id,
      hlc,
      authorId: LOCAL_USER_ID,
      type: 'create',
      payload: { content: params.content, title: params.title, type: params.type, tags: params.tags },
      scope: 'personal',
      teamId: null,
      orgId: null,
    };
    await this.store.createOperation(op);

    return id;
  }

  private logAndReturn(
    source: string,
    sourceDetail: string,
    stored: boolean,
    memoryId?: string,
    reason?: string,
  ): IngestResult {
    this.addLogEntry(source, sourceDetail, stored, memoryId, undefined, reason);
    return { stored, memoryId, reason };
  }

  private addLogEntry(
    source: string,
    sourceDetail: string,
    stored: boolean,
    memoryId?: string,
    memoryIds?: string[],
    reason?: string,
  ): void {
    const entry: IngestLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      source,
      sourceDetail,
      stored,
      memoryId,
      memoryIds,
      reason,
    };
    this.log.push(entry);
    // Trim log to max size
    if (this.log.length > this.maxLogEntries) {
      this.log = this.log.slice(-this.maxLogEntries);
    }
  }
}
