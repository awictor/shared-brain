/**
 * @shared-brain/sync — Sync engine for SharedBrain.
 *
 * Provides both client-side sync (for nodes) and the relay server
 * that coordinates multi-user sync over WebSocket.
 */

// ─── Protocol ───────────────────────────────────────────────────────────────
export {
  type SyncMessage,
  type ScopeFilter,
  type AuthMessage,
  type AuthOkMessage,
  type AuthFailMessage,
  type SyncStartMessage,
  type SyncNeedMessage,
  type SyncOkMessage,
  type SyncOpsMessage,
  type SyncAckMessage,
  type SyncCompleteMessage,
  type LiveOpMessage,
  type LiveAckMessage,
  type ErrorMessage,
  encode,
  decode,
} from './protocol/messages.js';

export {
  type SignedEnvelope,
  createEnvelope,
  encodeEnvelope,
  decodeEnvelope,
  verifyEnvelope,
} from './protocol/envelope.js';

export { MerkleSyncTree } from './protocol/diff.js';

// ─── Client ─────────────────────────────────────────────────────────────────
export {
  SyncClient,
  type SyncClientConfig,
  type SyncStatus,
  type ConnectionStatus,
  type RemoteOpCallback,
} from './client/sync-client.js';

export {
  OfflineQueue,
  type QueueDatabase,
} from './client/queue.js';

export {
  Reconciler,
  type ReconcilerStore,
  type ReconcilerEmbeddings,
  type EmbeddingStore,
  type MemoryRecord,
} from './client/reconciler.js';

// ─── Relay ──────────────────────────────────────────────────────────────────
export {
  RelayServer,
  type RelayServerConfig,
  type TokenValidationResult,
} from './relay/relay-server.js';

export {
  RoomManager,
  type RoomMember,
} from './relay/rooms.js';

export {
  RelayPersistence,
  type RelayPersistenceConfig,
} from './relay/persistence.js';
