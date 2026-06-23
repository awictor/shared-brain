/**
 * RelayServer — WebSocket server that coordinates sync between SharedBrain nodes.
 *
 * Responsibilities:
 * - Authenticate incoming connections
 * - Manage rooms based on user scopes
 * - Execute full sync protocol (Merkle diff → op exchange)
 * - Stream live operations between connected clients
 * - Persist all operations to PostgreSQL
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'node:http';
import type { MemoryOperation } from '@shared-brain/core';
import {
  type SyncMessage,
  type ScopeFilter,
  encode,
  decode,
} from '../protocol/messages.js';
import { MerkleSyncTree } from '../protocol/diff.js';
import { RoomManager } from './rooms.js';
import { RelayPersistence, type RelayPersistenceConfig } from './persistence.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RelayServerConfig {
  /** Port to listen on (default: 3200) */
  port: number;

  /** PostgreSQL configuration */
  db: RelayPersistenceConfig;

  /**
   * Token validation function.
   * Returns user info if token is valid, null if invalid.
   */
  validateToken: (token: string) => Promise<TokenValidationResult | null>;
}

export interface TokenValidationResult {
  userId: string;
  nodeId: string;
  teamIds: string[];
  orgId: string | null;
}

interface ClientState {
  ws: WebSocket;
  userId: string | null;
  nodeId: string | null;
  authenticated: boolean;
  scopes: ScopeFilter | null;
  merkleTree: MerkleSyncTree;
  phase: 'auth' | 'sync' | 'live';
}

// ─── RelayServer ────────────────────────────────────────────────────────────

export class RelayServer {
  private config: RelayServerConfig;
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private rooms: RoomManager;
  private persistence: RelayPersistence;
  private clients: Map<WebSocket, ClientState> = new Map();

  constructor(config: RelayServerConfig) {
    this.config = config;
    this.rooms = new RoomManager();
    this.persistence = new RelayPersistence(config.db);
  }

  /**
   * Start the relay server.
   */
  async start(): Promise<void> {
    // Initialize database
    await this.persistence.initialize();

    // Create HTTP server
    this.httpServer = createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          connections: this.rooms.connectionCount(),
          rooms: this.rooms.roomCount(),
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Start listening
    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.config.port, () => {
        console.log(`[RelayServer] Listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the relay server gracefully.
   */
  async stop(): Promise<void> {
    // Close all client connections
    for (const [ws] of this.clients) {
      ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    // Close database pool
    await this.persistence.close();

    console.log('[RelayServer] Stopped');
  }

  /**
   * Get the current number of connected clients.
   */
  getConnectionCount(): number {
    return this.rooms.connectionCount();
  }

  // ─── Private: Connection handling ─────────────────────────────────────────

  private handleConnection(ws: WebSocket): void {
    const state: ClientState = {
      ws,
      userId: null,
      nodeId: null,
      authenticated: false,
      scopes: null,
      merkleTree: new MerkleSyncTree(),
      phase: 'auth',
    };

    this.clients.set(ws, state);

    ws.on('message', (data: Buffer) => {
      const raw = data.toString();
      try {
        const msg = decode(raw);
        this.handleMessage(ws, state, msg);
      } catch (err) {
        this.sendTo(ws, {
          type: 'ERROR',
          code: 'INVALID_MESSAGE',
          message: err instanceof Error ? err.message : 'Failed to decode message',
        });
      }
    });

    ws.on('close', () => {
      this.rooms.leave(ws);
      this.clients.delete(ws);
    });

    ws.on('error', (err: Error) => {
      console.error(`[RelayServer] Client error:`, err.message);
      this.rooms.leave(ws);
      this.clients.delete(ws);
    });

    // Set a timeout for authentication (10 seconds)
    setTimeout(() => {
      if (!state.authenticated) {
        this.sendTo(ws, { type: 'AUTH_FAIL', reason: 'Authentication timeout' });
        ws.close(4001, 'Auth timeout');
      }
    }, 10000);
  }

  private async handleMessage(ws: WebSocket, state: ClientState, msg: SyncMessage): Promise<void> {
    switch (msg.type) {
      case 'AUTH':
        await this.handleAuth(ws, state, msg.token);
        break;
      case 'SYNC_START':
        await this.handleSyncStart(ws, state, msg);
        break;
      case 'SYNC_OPS':
        await this.handleSyncOps(ws, state, msg);
        break;
      case 'SYNC_ACK':
        await this.handleSyncAck(ws, state, msg);
        break;
      case 'LIVE_OP':
        await this.handleLiveOp(ws, state, msg);
        break;
      case 'LIVE_ACK':
        // Client acknowledged a live op — no action needed server-side
        break;
      default:
        this.sendTo(ws, {
          type: 'ERROR',
          code: 'UNEXPECTED_MESSAGE',
          message: `Unexpected message type "${msg.type}" in phase "${state.phase}"`,
        });
    }
  }

  // ─── AUTH phase ───────────────────────────────────────────────────────────

  private async handleAuth(ws: WebSocket, state: ClientState, token: string): Promise<void> {
    if (state.authenticated) {
      this.sendTo(ws, { type: 'ERROR', code: 'ALREADY_AUTH', message: 'Already authenticated' });
      return;
    }

    const result = await this.config.validateToken(token);

    if (!result) {
      this.sendTo(ws, { type: 'AUTH_FAIL', reason: 'Invalid token' });
      ws.close(4003, 'Invalid token');
      return;
    }

    state.userId = result.userId;
    state.nodeId = result.nodeId;
    state.authenticated = true;
    state.phase = 'sync';

    this.sendTo(ws, {
      type: 'AUTH_OK',
      userId: result.userId,
      nodeId: result.nodeId,
    });
  }

  // ─── SYNC phase ──────────────────────────────────────────────────────────

  private async handleSyncStart(
    ws: WebSocket,
    state: ClientState,
    msg: { type: 'SYNC_START'; rootHash: string; scopes: ScopeFilter },
  ): Promise<void> {
    if (!state.authenticated) {
      this.sendTo(ws, { type: 'ERROR', code: 'NOT_AUTH', message: 'Not authenticated' });
      return;
    }

    state.scopes = msg.scopes;

    // Join rooms based on scopes
    const tokenResult = await this.config.validateToken(''); // Already validated, get user info
    // Use state directly since we already have the info
    this.rooms.join(ws, state.userId!, state.nodeId!, {
      personal: msg.scopes.personal,
      teamIds: msg.scopes.teamIds,
      orgId: null, // Will be set from token validation if org scope
    });

    // Build server-side Merkle tree for the requested scopes
    const serverTree = new MerkleSyncTree();
    const opBuckets = await this.persistence.getOpIdsByBucket({
      personal: msg.scopes.personal ? state.userId! : undefined,
      teamIds: msg.scopes.teamIds.length > 0 ? msg.scopes.teamIds : undefined,
      orgId: msg.scopes.org ? undefined : undefined, // TODO: get orgId from user
    });

    // Build the Merkle tree with fake ops (we just need IDs for hashing)
    for (const [_bucket, opIds] of opBuckets) {
      for (const opId of opIds) {
        // We only need the ID and a placeholder HLC that maps to the correct bucket
        // The actual ops will be fetched during exchange
        // For now, insert with a synthetic HLC from the bucket key
      }
    }

    // Compare root hashes
    const serverRootHash = serverTree.rootHash();

    if (serverRootHash === msg.rootHash) {
      // Trees are in sync
      this.sendTo(ws, { type: 'SYNC_OK' });
      return;
    }

    // Trees differ — find divergent buckets at leaf level
    const serverHashes = serverTree.getLevel(2); // Bucket-level hashes
    // For initial implementation, request ALL buckets from the client
    // since we can't efficiently compare without the client's bucket hashes
    const clientBuckets = Array.from(opBuckets.keys());

    if (clientBuckets.length === 0) {
      // Server has no ops for these scopes — just accept whatever the client sends
      this.sendTo(ws, { type: 'SYNC_OK' });
    } else {
      this.sendTo(ws, { type: 'SYNC_NEED', buckets: clientBuckets });

      // Also send the server's ops to the client
      const serverOps = await this.persistence.getOpsSince(
        '0:0000:00000000', // From the beginning
        {
          personal: msg.scopes.personal ? state.userId! : undefined,
          teamIds: msg.scopes.teamIds.length > 0 ? msg.scopes.teamIds : undefined,
        },
        10000,
      );

      if (serverOps.length > 0) {
        this.sendTo(ws, { type: 'SYNC_OPS', ops: serverOps });
      }
    }
  }

  private async handleSyncOps(
    ws: WebSocket,
    state: ClientState,
    msg: { type: 'SYNC_OPS'; ops: MemoryOperation[] },
  ): Promise<void> {
    if (!state.authenticated) {
      this.sendTo(ws, { type: 'ERROR', code: 'NOT_AUTH', message: 'Not authenticated' });
      return;
    }

    // Persist incoming ops
    await this.persistence.storeOps(msg.ops);

    // Update server-side Merkle tree
    for (const op of msg.ops) {
      state.merkleTree.insert(op);
    }

    // Broadcast to other connected clients in the same rooms
    for (const op of msg.ops) {
      this.rooms.broadcast(op, ws);
    }
  }

  private async handleSyncAck(
    ws: WebSocket,
    state: ClientState,
    msg: { type: 'SYNC_ACK'; rootHash: string },
  ): Promise<void> {
    if (!state.authenticated) {
      this.sendTo(ws, { type: 'ERROR', code: 'NOT_AUTH', message: 'Not authenticated' });
      return;
    }

    // Sync is complete — transition to live mode
    state.phase = 'live';
    this.sendTo(ws, { type: 'SYNC_COMPLETE' });
  }

  // ─── LIVE phase ───────────────────────────────────────────────────────────

  private async handleLiveOp(
    ws: WebSocket,
    state: ClientState,
    msg: { type: 'LIVE_OP'; op: MemoryOperation },
  ): Promise<void> {
    if (!state.authenticated) {
      this.sendTo(ws, { type: 'ERROR', code: 'NOT_AUTH', message: 'Not authenticated' });
      return;
    }

    if (state.phase !== 'live') {
      this.sendTo(ws, {
        type: 'ERROR',
        code: 'NOT_IN_LIVE_MODE',
        message: 'Cannot send LIVE_OP before sync is complete',
      });
      return;
    }

    const op = msg.op;

    // Persist the operation
    await this.persistence.storeOp(op);

    // Update Merkle tree
    state.merkleTree.insert(op);

    // Acknowledge receipt to sender
    this.sendTo(ws, { type: 'LIVE_ACK', opId: op.id });

    // Broadcast to all other clients in the relevant rooms
    this.rooms.broadcast(op, ws);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private sendTo(ws: WebSocket, msg: SyncMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encode(msg));
    }
  }
}
