/**
 * Merkle-tree based diff algorithm for efficient sync.
 *
 * Operations are bucketed by time (hour granularity). Each bucket's hash
 * is the SHA-256 of sorted operation IDs within it. The tree is built bottom-up:
 * leaf = bucket hash, internal nodes = SHA-256(concat(child hashes)).
 *
 * During sync, the client and server compare root hashes. If they differ,
 * they walk down the tree level-by-level to find divergent buckets, then
 * exchange only those buckets' operations.
 */

import { createHash } from 'node:crypto';
import type { MemoryOperation } from '@shared-brain/core';

/**
 * Get the time bucket key for a given HLC timestamp.
 * Bucket granularity: 1 hour.
 *
 * HLC format: "{wallMs}:{counter}:{nodeId}"
 * Bucket format: "YYYY-MM-DDTHH:00" (ISO hour)
 */
function getBucketKey(hlc: string): string {
  const wallMs = parseInt(hlc.split(':')[0], 10);
  const date = new Date(wallMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:00`;
}

/**
 * Compute SHA-256 hash of a string, returned as hex.
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * MerkleSyncTree — maintains a hash tree over the operation log,
 * bucketed by hour for efficient diffing.
 */
export class MerkleSyncTree {
  /**
   * Map of bucket key → sorted set of operation IDs in that bucket.
   */
  private buckets: Map<string, Set<string>> = new Map();

  /**
   * Cached hash per bucket (invalidated on insert).
   */
  private bucketHashes: Map<string, string> = new Map();

  /**
   * Cached root hash (invalidated on any insert).
   */
  private cachedRootHash: string | null = null;

  /**
   * Insert an operation into the Merkle tree.
   */
  insert(op: MemoryOperation): void {
    const bucket = getBucketKey(op.hlc);

    let opSet = this.buckets.get(bucket);
    if (!opSet) {
      opSet = new Set();
      this.buckets.set(bucket, opSet);
    }

    if (!opSet.has(op.id)) {
      opSet.add(op.id);
      // Invalidate caches
      this.bucketHashes.delete(bucket);
      this.cachedRootHash = null;
    }
  }

  /**
   * Compute the hash of a single bucket (SHA-256 of sorted op IDs).
   */
  private computeBucketHash(bucket: string): string {
    const cached = this.bucketHashes.get(bucket);
    if (cached) return cached;

    const opSet = this.buckets.get(bucket);
    if (!opSet || opSet.size === 0) {
      const hash = sha256('');
      this.bucketHashes.set(bucket, hash);
      return hash;
    }

    const sorted = Array.from(opSet).sort();
    const hash = sha256(sorted.join('\n'));
    this.bucketHashes.set(bucket, hash);
    return hash;
  }

  /**
   * Get the root hash of the entire tree.
   * Computed as SHA-256 of all bucket hashes concatenated in sorted bucket order.
   */
  rootHash(): string {
    if (this.cachedRootHash) return this.cachedRootHash;

    if (this.buckets.size === 0) {
      this.cachedRootHash = sha256('empty');
      return this.cachedRootHash;
    }

    const sortedBuckets = Array.from(this.buckets.keys()).sort();
    const concatenated = sortedBuckets
      .map((bucket) => this.computeBucketHash(bucket))
      .join('');

    this.cachedRootHash = sha256(concatenated);
    return this.cachedRootHash;
  }

  /**
   * Get hashes at a specific depth level for comparison.
   *
   * Depth 0 = root hash (single entry)
   * Depth 1 = day-level hashes (group buckets by day)
   * Depth 2 = bucket-level hashes (individual hour buckets)
   *
   * Returns a Map of key → hash.
   */
  getLevel(depth: number): Map<string, string> {
    const result = new Map<string, string>();

    if (depth === 0) {
      result.set('root', this.rootHash());
      return result;
    }

    if (depth >= 2) {
      // Leaf level: individual bucket hashes
      for (const bucket of this.buckets.keys()) {
        result.set(bucket, this.computeBucketHash(bucket));
      }
      return result;
    }

    // Depth 1: group by day
    const dayGroups = new Map<string, string[]>();
    for (const bucket of this.buckets.keys()) {
      const day = bucket.split('T')[0]; // "YYYY-MM-DD"
      let group = dayGroups.get(day);
      if (!group) {
        group = [];
        dayGroups.set(day, group);
      }
      group.push(bucket);
    }

    for (const [day, bucketKeys] of dayGroups) {
      bucketKeys.sort();
      const concatenated = bucketKeys
        .map((b) => this.computeBucketHash(b))
        .join('');
      result.set(day, sha256(concatenated));
    }

    return result;
  }

  /**
   * Find buckets that differ between this tree and a remote tree.
   *
   * @param remoteHashes - Map of bucket key → hash from the remote node
   * @returns Array of bucket keys that differ (present in either but hash mismatch, or missing from one side)
   */
  diff(remoteHashes: Map<string, string>): string[] {
    const divergent: string[] = [];

    // Check all local buckets against remote
    for (const [bucket, _opSet] of this.buckets) {
      const localHash = this.computeBucketHash(bucket);
      const remoteHash = remoteHashes.get(bucket);

      if (remoteHash === undefined || remoteHash !== localHash) {
        divergent.push(bucket);
      }
    }

    // Check for buckets remote has that we don't
    for (const [bucket, _hash] of remoteHashes) {
      if (!this.buckets.has(bucket)) {
        divergent.push(bucket);
      }
    }

    // Deduplicate and sort
    return [...new Set(divergent)].sort();
  }

  /**
   * Get all operation IDs within a specific bucket.
   */
  getOpsInBucket(bucket: string): string[] {
    const opSet = this.buckets.get(bucket);
    if (!opSet) return [];
    return Array.from(opSet).sort();
  }

  /**
   * Get all bucket keys in sorted order.
   */
  getBuckets(): string[] {
    return Array.from(this.buckets.keys()).sort();
  }

  /**
   * Get total number of operations tracked.
   */
  size(): number {
    let total = 0;
    for (const opSet of this.buckets.values()) {
      total += opSet.size;
    }
    return total;
  }
}
