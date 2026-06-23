/**
 * Token utilities for simple bearer-token authentication.
 *
 * Tokens are compared by hash to avoid timing attacks from raw string comparison.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Generate a SHA-256 hash of a token for storage/comparison.
 */
export function generateTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Validate a token against an expected hash using timing-safe comparison.
 * Returns true if the token's hash matches the expected hash.
 */
export function validateToken(token: string, expectedHash: string): boolean {
  const tokenHash = generateTokenHash(token);

  // Both are hex strings of SHA-256 — always 64 chars
  if (tokenHash.length !== expectedHash.length) {
    return false;
  }

  const a = Buffer.from(tokenHash, 'utf-8');
  const b = Buffer.from(expectedHash, 'utf-8');

  return timingSafeEqual(a, b);
}
