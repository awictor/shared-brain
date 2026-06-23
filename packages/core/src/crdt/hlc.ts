import type { HLC } from '../models/memory.js';

/**
 * Parsed HLC state.
 */
export interface HLCState {
  /** Wall clock in milliseconds */
  wallMs: number;
  /** Logical counter (incremented on ties) */
  counter: number;
  /** Unique node identifier */
  nodeId: string;
}

/**
 * Hybrid Logical Clock for causal ordering without centralized coordination.
 *
 * Guarantees:
 * - Monotonically increasing on a single node
 * - Causally consistent across nodes (via receive())
 * - Close to wall-clock time (bounded drift)
 */
export class HybridLogicalClock {
  private wallMs: number;
  private counter: number;
  private readonly nodeId: string;

  /** Maximum allowed drift from physical clock (5 minutes) */
  private static readonly MAX_DRIFT_MS = 5 * 60 * 1000;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.wallMs = Date.now();
    this.counter = 0;
  }

  /**
   * Generate a new HLC timestamp for a local event.
   * Ensures monotonic increase even if wall clock hasn't advanced.
   */
  now(): HLC {
    const physicalNow = Date.now();

    if (physicalNow > this.wallMs) {
      // Physical clock advanced — reset counter
      this.wallMs = physicalNow;
      this.counter = 0;
    } else {
      // Physical clock hasn't advanced — increment counter
      this.counter++;
    }

    return HybridLogicalClock.format(this.wallMs, this.counter, this.nodeId);
  }

  /**
   * Receive a remote HLC and update local state.
   * Returns a new HLC that is causally after both local state and the remote timestamp.
   */
  receive(remote: HLC): HLC {
    const remoteState = HybridLogicalClock.parse(remote);
    const physicalNow = Date.now();

    // Check for excessive drift
    if (remoteState.wallMs - physicalNow > HybridLogicalClock.MAX_DRIFT_MS) {
      throw new Error(
        `Remote HLC drift exceeds maximum (${remoteState.wallMs - physicalNow}ms). ` +
        `Remote clock may be too far in the future.`
      );
    }

    if (physicalNow > this.wallMs && physicalNow > remoteState.wallMs) {
      // Physical clock is ahead of both — use it, reset counter
      this.wallMs = physicalNow;
      this.counter = 0;
    } else if (this.wallMs === remoteState.wallMs) {
      // Same wall time — take max counter + 1
      this.counter = Math.max(this.counter, remoteState.counter) + 1;
    } else if (remoteState.wallMs > this.wallMs) {
      // Remote is ahead — adopt remote wall time, increment its counter
      this.wallMs = remoteState.wallMs;
      this.counter = remoteState.counter + 1;
    } else {
      // Local is ahead — just increment our counter
      this.counter++;
    }

    return HybridLogicalClock.format(this.wallMs, this.counter, this.nodeId);
  }

  /**
   * Get current state without advancing the clock.
   */
  getState(): HLCState {
    return { wallMs: this.wallMs, counter: this.counter, nodeId: this.nodeId };
  }

  /**
   * Parse an HLC string back to components.
   */
  static parse(hlc: HLC): HLCState {
    const parts = hlc.split(':');
    if (parts.length < 3) {
      throw new Error(`Invalid HLC format: "${hlc}". Expected "{wallMs}:{counter:04x}:{nodeId}"`);
    }
    const wallMs = parseInt(parts[0], 10);
    const counter = parseInt(parts[1], 16);
    const nodeId = parts.slice(2).join(':'); // nodeId might contain colons (unlikely but safe)

    if (isNaN(wallMs) || isNaN(counter)) {
      throw new Error(`Invalid HLC format: "${hlc}". Could not parse wallMs or counter.`);
    }

    return { wallMs, counter, nodeId };
  }

  /**
   * Compare two HLC values. Returns -1, 0, or 1.
   * Ordering: wallMs first, then counter, then nodeId (lexicographic tiebreaker).
   */
  static compare(a: HLC, b: HLC): -1 | 0 | 1 {
    const pa = HybridLogicalClock.parse(a);
    const pb = HybridLogicalClock.parse(b);

    if (pa.wallMs !== pb.wallMs) {
      return pa.wallMs < pb.wallMs ? -1 : 1;
    }
    if (pa.counter !== pb.counter) {
      return pa.counter < pb.counter ? -1 : 1;
    }
    if (pa.nodeId !== pb.nodeId) {
      return pa.nodeId < pb.nodeId ? -1 : 1;
    }
    return 0;
  }

  /**
   * Format HLC components into the canonical string representation.
   */
  static format(wallMs: number, counter: number, nodeId: string): HLC {
    return `${wallMs}:${counter.toString(16).padStart(4, '0')}:${nodeId}`;
  }
}
