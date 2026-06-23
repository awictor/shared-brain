/**
 * SyncClient — manages the WebSocket connection to the relay server,
 * handles the full sync protocol (AUTH → SYNC → LIVE), and coordinates
 * local/remote operation exchange.
 */

import WebSocket from 'ws';
import type { MemoryOperation } from '@shared-brain/core';
import {
  type SyncMessage,
  type ScopeFilter,
  encode,
  decode,
} from '../protocol/messages.js';
import { MerkleSyncTree } from '../protocol/diff.js';
import { OfflineQueue, type QueueDatabase } from './queue.js';
import {
  Reconciler,
  type ReconcilerStore,
  type ReconcilerEmbeddings,
  type EmbeddingStore,
} from './reconciler.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'authenticating' | 'syncing' | 'live';

export interface SyncClientConfig {
  /** WebSocket URL of the relay server (e.g. "ws://localhost:3200") */
  url: string;

  /** Auth token for the relay server */
  token: string;

  /** Local SQLite store (implements ReconcilerStore + QueueDatabase) */
  store: ReconcilerStore & QueueDatabase;

  /** Embedding engine for recomputing embeddings on content changes */
  embeddings: ReconcilerEmbeddings;

  /** Store for persisting embeddings */
  embeddingStore: EmbeddingStore;

  /** Scopes to sync (which rooms to join) */
  scopes: ScopeFilter;

  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;

  /** Reconnect delay in ms (default: 3000) */
  reconnectDelay?: number;

  /** Max reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
}

export interface SyncStatus {
  connection: ConnectionStatus;
  pendingOps: number;
  lastSyncAt: string | null;
  userId: string | null;
  nodeId: string | null;
}

export type RemoteOpCallback = (op: MemoryOperation) => void;

// ─── SyncClient ─────────────────────────────────────────────────────────────

export class SyncClient {
  private config: SyncClientConfig;
  private ws: WebSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private userId: string | null = null;
  private nodeId: string | null = null;
  private lastSyncAt: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private queue: OfflineQueue;
  private reconciler: Reconciler;
  private merkleTree: MerkleSyncTree;
  private onRemoteOpCallback: RemoteOpCallback | null = null;

  constructor(config: SyncClientConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 3000,
      maxReconnectAttempts: Infinity,
      ...config,
    };

    this.queue = new OfflineQueue(config.store);
    this.reconciler = new Reconciler(config.store, config.embeddings, config.embeddingStore);
    this.merkleTree = new MerkleSyncTree();
  }

  /**
   * Register a callback for when remote operations arrive.
   */
  set onRemoteOp(cb: RemoteOpCallback | null) {
    this.onRemoteOpCallback = cb;
  }

  /**
   * Connect to the relay server and begin the sync protocol.
   */
  async connect(): Promise<void> {
    if (this.ws && this.status !== 'disconnected') {
      return; // Already connected or connecting
    }

    this.status = 'connecting';
    this.reconnectAttempts = 0;

    // Build the Merkle tree from pending ops before connecting
    const pendingOps = await this.queue.pending();
    for (const op of pendingOps) {
      this.merkleTree.insert(op);
    }

    this.createWebSocket();
  }

  /**
   * Disconnect from the relay server.
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.status = 'disconnected';
  }

  /**
   * Push a new local operation to the relay in real-time.
   * If disconnected, queues it for later sync.
   */
  async pushLocalOp(op: MemoryOperation): Promise<void> {
    // Always enqueue locally first (persistence)
    await this.queue.enqueue(op);
    this.merkleTree.insert(op);

    // If in live mode, send immediately
    if (this.status === 'live' && this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'LIVE_OP', op });
    }
  }

  /**
   * Get the current sync status.
   */
  async getStatus(): Promise<SyncStatus> {
    return {
      connection: this.status,
      pendingOps: await this.queue.size(),
      lastSyncAt: this.lastSyncAt,
      userId: this.userId,
      nodeId: this.nodeId,
    };
  }

  // ─── Private methods ────────────────────────────────────────────────────

  private createWebSocket(): void {
    this.ws = new WebSocket(this.config.url);

    this.ws.on('open', () => {
      this.status = 'authenticating';
      this.send({ type: 'AUTH', token: this.config.token });
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      const raw = data.toString();
      try {
        const msg = decode(raw);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[SyncClient] Failed to decode message:', err);
      }
    });

    this.ws.on('close', (_code: number, _reason: Buffer) => {
      this.status = 'disconnected';
      this.ws = null;
      this.attemptReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[SyncClient] WebSocket error:', err.message);
      // The close event will fire after this, triggering reconnect
    });
  }

  private handleMessage(msg: SyncMessage): void {
    switch (msg.type) {
      case 'AUTH_OK':
        this.handleAuthOk(msg);
        break;
      case 'AUTH_FAIL':
        console.error('[SyncClient] Auth failed:', msg.reason);
        this.disconnect();
        break;
      case 'SYNC_NEED':
        this.handleSyncNeed(msg);
        break;
      case 'SYNC_OK':
        this.handleSyncOk();
        break;
      case 'SYNC_OPS':
        this.handleSyncOps(msg);
        break;
      case 'SYNC_COMPLETE':
        this.handleSyncComplete();
        break;
      case 'LIVE_OP':
        this.handleLiveOp(msg);
        break;
      case 'LIVE_ACK':
        this.handleLiveAck(msg);
        break;
      case 'ERROR':
        console.error(`[SyncClient] Server error [${msg.code}]: ${msg.message}`);
        break;
      default:
        // Ignore unexpected messages
        break;
    }
  }

  private handleAuthOk(msg: { type: 'AUTH_OK'; userId: string; nodeId: string }): void {
    this.userId = msg.userId;
    this.nodeId = msg.nodeId;
    this.status = 'syncing';

    // Start the sync protocol
    this.send({
      type: 'SYNC_START',
      rootHash: this.merkleTree.rootHash(),
      scopes: this.config.scopes,
    });
  }

  private async handleSyncNeed(msg: { type: 'SYNC_NEED'; buckets: string[] }): Promise<void> {
    // Server needs ops from these buckets — send them
    const pendingOps = await this.queue.pending();
    const requestedOps = pendingOps.filter((op) => {
      const wallMs = parseInt(op.hlc.split(':')[0], 10);
      const date = new Date(wallMs);
      const bucket = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:00`;
      return msg.buckets.includes(bucket);
    });

    if (requestedOps.length > 0) {
      this.send({ type: 'SYNC_OPS', ops: requestedOps });
    }
  }

  private handleSyncOk(): void {
    // Trees are in sync, skip to ack
    this.send({ type: 'SYNC_ACK', rootHash: this.merkleTree.rootHash() });
  }

  private async handleSyncOps(msg: { type: 'SYNC_OPS'; ops: MemoryOperation[] }): Promise<void> {
    // Apply remote operations via reconciler
    const changedIds = await this.reconciler.applyRemoteOps(msg.ops);

    // Update local Merkle tree
    for (const op of msg.ops) {
      this.merkleTree.insert(op);
    }

    // Notify callback for each applied op
    if (this.onRemoteOpCallback) {
      for (const op of msg.ops) {
        this.onRemoteOpCallback(op);
      }
    }

    // Send ack with updated root hash
    this.send({ type: 'SYNC_ACK', rootHash: this.merkleTree.rootHash() });
  }

  private handleSyncComplete(): void {
    this.status = 'live';
    this.lastSyncAt = new Date().toISOString();
    this.reconnectAttempts = 0;

    // Drain any remaining pending ops in live mode
    this.drainPendingOps();
  }

  private async handleLiveOp(msg: { type: 'LIVE_OP'; op: MemoryOperation }): Promise<void> {
    // Apply the single remote op
    await this.reconciler.applyRemoteOps([msg.op]);
    this.merkleTree.insert(msg.op);

    // Acknowledge receipt
    this.send({ type: 'LIVE_ACK', opId: msg.op.id });

    // Notify callback
    if (this.onRemoteOpCallback) {
      this.onRemoteOpCallback(msg.op);
    }
  }

  private async handleLiveAck(msg: { type: 'LIVE_ACK'; opId: string }): Promise<void> {
    // Mark the operation as synced
    await this.queue.acknowledge([msg.opId]);
  }

  /**
   * Send any pending ops that haven't been synced yet (for reconnection scenarios).
   */
  private async drainPendingOps(): Promise<void> {
    if (this.status !== 'live' || !this.ws) return;

    const pending = await this.queue.pending();
    for (const op of pending) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'LIVE_OP', op });
      } else {
        break; // Connection lost during drain
      }
    }
  }

  /**
   * Attempt to reconnect after a disconnect.
   */
  private attemptReconnect(): void {
    if (!this.config.autoReconnect) return;
    if (this.reconnectAttempts >= (this.config.maxReconnectAttempts ?? Infinity)) {
      console.error('[SyncClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      (this.config.reconnectDelay ?? 3000) * Math.pow(1.5, this.reconnectAttempts - 1),
      30000, // Cap at 30 seconds
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.createWebSocket();
    }, delay);
  }

  /**
   * Send a message over the WebSocket.
   */
  private send(msg: SyncMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    }
  }
}
