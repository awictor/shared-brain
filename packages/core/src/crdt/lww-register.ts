import type { HLC } from '../models/memory.js';
import { HybridLogicalClock } from './hlc.js';

/**
 * A Last-Writer-Wins field: a value paired with the HLC at which it was written.
 */
export interface LWWField<T> {
  value: T;
  hlc: HLC;
}

/**
 * Merge two LWW fields. The one with the higher HLC wins.
 * On tie (same HLC), local is preferred (stable).
 */
export function mergeLWW<T>(local: LWWField<T>, remote: LWWField<T>): LWWField<T> {
  const cmp = HybridLogicalClock.compare(local.hlc, remote.hlc);
  if (cmp >= 0) return local;
  return remote;
}

/**
 * Create a new LWW field with a value and timestamp.
 */
export function createLWWField<T>(value: T, hlc: HLC): LWWField<T> {
  return { value, hlc };
}
