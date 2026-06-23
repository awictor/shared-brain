/**
 * SignedEnvelope wraps a sync message with metadata for integrity
 * and future cryptographic verification.
 */

import type { SyncMessage } from './messages.js';
import { randomUUID } from 'node:crypto';

export interface SignedEnvelope {
  /** Unique message ID (UUIDv4) */
  messageId: string;

  /** ISO 8601 timestamp of when the envelope was created */
  timestamp: string;

  /** The actual sync protocol message */
  payload: SyncMessage;

  /**
   * Signature placeholder — will hold an HMAC-SHA256 or Ed25519 signature
   * of the payload once key management is implemented.
   * For now, set to null (unsigned).
   */
  signature: string | null;
}

/**
 * Wrap a SyncMessage in a SignedEnvelope with auto-generated ID and timestamp.
 */
export function createEnvelope(payload: SyncMessage): SignedEnvelope {
  return {
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
    payload,
    signature: null,
  };
}

/**
 * Serialize a SignedEnvelope to JSON string for wire transmission.
 */
export function encodeEnvelope(envelope: SignedEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Deserialize a raw string into a SignedEnvelope.
 * Throws if the structure is invalid.
 */
export function decodeEnvelope(raw: string): SignedEnvelope {
  const parsed = JSON.parse(raw);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof parsed.messageId !== 'string' ||
    typeof parsed.timestamp !== 'string' ||
    typeof parsed.payload !== 'object'
  ) {
    throw new Error('Invalid envelope structure');
  }

  return parsed as SignedEnvelope;
}

/**
 * Verify envelope signature (placeholder — always returns true for now).
 * Will be replaced with actual cryptographic verification.
 */
export function verifyEnvelope(_envelope: SignedEnvelope): boolean {
  // TODO: Implement HMAC-SHA256 or Ed25519 signature verification
  return true;
}
