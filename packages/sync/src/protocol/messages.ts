/**
 * Wire protocol message types for SharedBrain sync.
 *
 * All messages are JSON-serialized over WebSocket frames.
 * The protocol flows: AUTH → SYNC → LIVE mode.
 */

import type { MemoryOperation, MemoryScope } from '@shared-brain/core';

// ─── Scope filter (which scopes the client wants to sync) ───────────────────

export interface ScopeFilter {
  personal: boolean;
  teamIds: string[];
  org: boolean;
}

// ─── Authentication messages ────────────────────────────────────────────────

export interface AuthMessage {
  type: 'AUTH';
  token: string;
}

export interface AuthOkMessage {
  type: 'AUTH_OK';
  userId: string;
  nodeId: string;
}

export interface AuthFailMessage {
  type: 'AUTH_FAIL';
  reason: string;
}

// ─── Sync protocol messages ─────────────────────────────────────────────────

export interface SyncStartMessage {
  type: 'SYNC_START';
  rootHash: string;
  scopes: ScopeFilter;
}

export interface SyncNeedMessage {
  type: 'SYNC_NEED';
  buckets: string[];
}

export interface SyncOkMessage {
  type: 'SYNC_OK';
}

export interface SyncOpsMessage {
  type: 'SYNC_OPS';
  ops: MemoryOperation[];
}

export interface SyncAckMessage {
  type: 'SYNC_ACK';
  rootHash: string;
}

export interface SyncCompleteMessage {
  type: 'SYNC_COMPLETE';
}

// ─── Live streaming messages ────────────────────────────────────────────────

export interface LiveOpMessage {
  type: 'LIVE_OP';
  op: MemoryOperation;
}

export interface LiveAckMessage {
  type: 'LIVE_ACK';
  opId: string;
}

// ─── Error message ──────────────────────────────────────────────────────────

export interface ErrorMessage {
  type: 'ERROR';
  code: string;
  message: string;
}

// ─── Union type ─────────────────────────────────────────────────────────────

export type SyncMessage =
  | AuthMessage
  | AuthOkMessage
  | AuthFailMessage
  | SyncStartMessage
  | SyncNeedMessage
  | SyncOkMessage
  | SyncOpsMessage
  | SyncAckMessage
  | SyncCompleteMessage
  | LiveOpMessage
  | LiveAckMessage
  | ErrorMessage;

// ─── Encode / Decode ────────────────────────────────────────────────────────

/**
 * Encode a SyncMessage to a JSON string for wire transmission.
 */
export function encode(message: SyncMessage): string {
  return JSON.stringify(message);
}

/**
 * Decode a raw WebSocket frame (string) into a typed SyncMessage.
 * Throws if the payload is not valid JSON or has no `type` field.
 */
export function decode(raw: string): SyncMessage {
  const parsed = JSON.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
    throw new Error('Invalid message: missing "type" field');
  }

  const validTypes = new Set<string>([
    'AUTH', 'AUTH_OK', 'AUTH_FAIL',
    'SYNC_START', 'SYNC_NEED', 'SYNC_OK', 'SYNC_OPS', 'SYNC_ACK', 'SYNC_COMPLETE',
    'LIVE_OP', 'LIVE_ACK',
    'ERROR',
  ]);

  if (!validTypes.has(parsed.type)) {
    throw new Error(`Invalid message type: ${parsed.type}`);
  }

  return parsed as SyncMessage;
}
