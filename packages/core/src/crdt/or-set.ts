import type { HLC } from '../models/memory.js';

/**
 * An entry in the OR-Set: a value with its set of active "dots" (add-event HLCs).
 */
export interface ORSetEntry<T> {
  value: T;
  /** Active dots — each represents an add event not yet removed */
  dots: Set<HLC>;
}

/**
 * Serialized form of an OR-Set for JSON storage.
 */
export interface ORSetJSON<T> {
  entries: Array<{ value: T; dots: string[] }>;
  tombstones: Array<{ value: string; dots: string[] }>;
}

/**
 * Observed-Remove Set (OR-Set) CRDT.
 *
 * Semantics:
 * - Each add generates a unique "dot" (the HLC at add time).
 * - Remove records which specific dots are removed (only those observed at remove time).
 * - An element is in the set if it has at least one un-removed dot.
 * - Concurrent add + remove: the add wins (since the remove didn't observe that dot).
 */
export class ORSet<T> {
  /** Active entries: serialized value -> entry with active dots */
  private entries: Map<string, ORSetEntry<T>> = new Map();
  /** Tombstoned dots per value (to prevent re-add of removed dots during merge) */
  private tombstones: Map<string, Set<HLC>> = new Map();

  /**
   * Serialize a value to a map key.
   */
  private key(value: T): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  /**
   * Add a value to the set, tagged with the given HLC as its dot.
   */
  add(value: T, hlc: HLC): void {
    const k = this.key(value);
    const existing = this.entries.get(k);

    if (existing) {
      existing.dots.add(hlc);
    } else {
      this.entries.set(k, { value, dots: new Set([hlc]) });
    }
  }

  /**
   * Remove a value from the set.
   * Only removes the dots that are currently observed (causal remove).
   * If the value has no remaining dots after removal, it leaves the set.
   */
  remove(value: T): void {
    const k = this.key(value);
    const existing = this.entries.get(k);
    if (!existing) return;

    // Move all current dots to tombstones
    let tombstone = this.tombstones.get(k);
    if (!tombstone) {
      tombstone = new Set();
      this.tombstones.set(k, tombstone);
    }

    for (const dot of existing.dots) {
      tombstone.add(dot);
    }

    // Remove the entry (no active dots remain)
    this.entries.delete(k);
  }

  /**
   * Remove a value with specific observed dots only.
   * This is used during merge to apply a remote remove that only observed certain dots.
   */
  removeWithDots(value: T, observedDots: Set<HLC>): void {
    const k = this.key(value);
    const existing = this.entries.get(k);

    // Record tombstones
    let tombstone = this.tombstones.get(k);
    if (!tombstone) {
      tombstone = new Set();
      this.tombstones.set(k, tombstone);
    }
    for (const dot of observedDots) {
      tombstone.add(dot);
    }

    if (!existing) return;

    // Remove only the observed dots
    for (const dot of observedDots) {
      existing.dots.delete(dot);
    }

    // If no dots remain, remove the entry
    if (existing.dots.size === 0) {
      this.entries.delete(k);
    }
  }

  /**
   * Merge a remote OR-Set into this one.
   *
   * For each value:
   * - Union the dots from both sides
   * - Subtract dots that appear in the other side's tombstones
   */
  merge(remote: ORSet<T>): void {
    // Process all remote entries
    for (const [k, remoteEntry] of remote.entries) {
      const localEntry = this.entries.get(k);
      const localTombstones = this.tombstones.get(k) ?? new Set<HLC>();

      // Start with remote dots minus our tombstones
      const survivingRemoteDots = new Set<HLC>();
      for (const dot of remoteEntry.dots) {
        if (!localTombstones.has(dot)) {
          survivingRemoteDots.add(dot);
        }
      }

      if (localEntry) {
        // Merge: keep local dots that aren't in remote tombstones, plus surviving remote dots
        const remoteTombstones = remote.tombstones.get(k) ?? new Set<HLC>();
        const mergedDots = new Set<HLC>();

        for (const dot of localEntry.dots) {
          if (!remoteTombstones.has(dot)) {
            mergedDots.add(dot);
          }
        }
        for (const dot of survivingRemoteDots) {
          mergedDots.add(dot);
        }

        if (mergedDots.size > 0) {
          localEntry.dots = mergedDots;
        } else {
          this.entries.delete(k);
        }
      } else if (survivingRemoteDots.size > 0) {
        // New entry from remote
        this.entries.set(k, { value: remoteEntry.value, dots: survivingRemoteDots });
      }
    }

    // Remove local entries whose dots are all tombstoned by remote
    for (const [k, localEntry] of this.entries) {
      const remoteTombstones = remote.tombstones.get(k) ?? new Set<HLC>();
      if (remoteTombstones.size === 0) continue;

      for (const dot of remoteTombstones) {
        localEntry.dots.delete(dot);
      }

      if (localEntry.dots.size === 0) {
        this.entries.delete(k);
      }
    }

    // Merge tombstones (union)
    for (const [k, remoteTomb] of remote.tombstones) {
      const localTomb = this.tombstones.get(k);
      if (localTomb) {
        for (const dot of remoteTomb) {
          localTomb.add(dot);
        }
      } else {
        this.tombstones.set(k, new Set(remoteTomb));
      }
    }
  }

  /**
   * Get all values currently in the set.
   */
  values(): T[] {
    return Array.from(this.entries.values()).map((e) => e.value);
  }

  /**
   * Check if a value is in the set.
   */
  has(value: T): boolean {
    const k = this.key(value);
    const entry = this.entries.get(k);
    return entry !== undefined && entry.dots.size > 0;
  }

  /**
   * Get the number of elements in the set.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Serialize to JSON-safe format.
   */
  toJSON(): ORSetJSON<T> {
    const entries: Array<{ value: T; dots: string[] }> = [];
    for (const [, entry] of this.entries) {
      entries.push({ value: entry.value, dots: Array.from(entry.dots) });
    }

    const tombstones: Array<{ value: string; dots: string[] }> = [];
    for (const [value, dots] of this.tombstones) {
      tombstones.push({ value, dots: Array.from(dots) });
    }

    return { entries, tombstones };
  }

  /**
   * Deserialize from JSON.
   */
  static fromJSON<T>(data: ORSetJSON<T>): ORSet<T> {
    const set = new ORSet<T>();

    for (const entry of data.entries) {
      const k = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      set.entries.set(k, { value: entry.value, dots: new Set(entry.dots) });
    }

    for (const tombstone of data.tombstones) {
      set.tombstones.set(tombstone.value, new Set(tombstone.dots));
    }

    return set;
  }
}
