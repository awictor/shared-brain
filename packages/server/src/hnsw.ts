/**
 * Hierarchical Navigable Small World (HNSW) Index
 *
 * Pure TypeScript implementation — no native dependencies.
 * Designed for 384-dimensional normalized vectors (cosine similarity via dot product).
 *
 * Paper: "Efficient and robust approximate nearest neighbor using
 *         Hierarchical Navigable Small World graphs" (Malkov & Yashunin, 2016)
 */

import type { VectorIndex } from './mcp/handler.js';

// ─── Serialization Format ───────────────────────────────────────────────────────

interface SerializedIndex {
  version: number;
  M: number;
  efConstruction: number;
  efSearch: number;
  dimensions: number;
  entryPoint: number;
  maxLevel: number;
  nodes: Array<{
    id: string;
    vector: number[];
    level: number;
    neighbors: number[][];
    deleted: boolean;
  }>;
}

// ─── HNSW Index ─────────────────────────────────────────────────────────────────

export class HNSWIndex implements VectorIndex {
  /** Max number of connections per node per layer */
  private readonly M: number;
  /** Max connections for layer 0 (typically 2*M) */
  private readonly M0: number;
  /** Size of the dynamic candidate list during construction */
  private readonly efConstruction: number;
  /** Size of the dynamic candidate list during search */
  private efSearch: number;
  /** Vector dimensionality */
  private readonly dimensions: number;
  /** Normalization factor for level generation: 1/ln(M) */
  private readonly mL: number;

  // ─── Node Storage (SoA layout for cache efficiency) ─────────────────────────

  /** Node IDs */
  private ids: string[] = [];
  /** Node vectors (flat, each node's vector is at offset idx*dimensions) */
  private vectors: Float32Array[] = [];
  /** Node level */
  private levels: number[] = [];
  /** Node deletion flag */
  private deleted: boolean[] = [];
  /** Adjacency lists: neighbors[idx][layer] = number[] */
  private neighbors: number[][][] = [];

  /** Map from external ID to internal index */
  private idToIndex: Map<string, number> = new Map();
  /** Entry point index (highest-level node) */
  private entryPoint: number = -1;
  /** Current max level in the graph */
  private maxLevel: number = -1;
  /** Count of non-deleted nodes */
  private activeCount: number = 0;

  constructor(options?: {
    M?: number;
    efConstruction?: number;
    efSearch?: number;
    dimensions?: number;
  }) {
    this.M = options?.M ?? 16;
    this.M0 = this.M * 2;
    this.efConstruction = options?.efConstruction ?? 200;
    this.efSearch = options?.efSearch ?? 50;
    this.dimensions = options?.dimensions ?? 384;
    this.mL = 1 / Math.log(this.M);
  }

  // ─── Public Interface ───────────────────────────────────────────────────────

  add(id: string, vector: Float32Array): void {
    if (this.idToIndex.has(id)) {
      this.remove(id);
    }

    const level = this.randomLevel();
    const idx = this.ids.length;

    this.ids.push(id);
    this.vectors.push(vector);
    this.levels.push(level);
    this.deleted.push(false);
    // Create adjacency list for each layer
    const adj: number[][] = new Array(level + 1);
    for (let i = 0; i <= level; i++) adj[i] = [];
    this.neighbors.push(adj);

    this.idToIndex.set(id, idx);
    this.activeCount++;

    if (this.entryPoint === -1) {
      this.entryPoint = idx;
      this.maxLevel = level;
      return;
    }

    let currObj = this.entryPoint;

    // Phase 1: Greedily traverse from top to node's level + 1
    for (let lc = this.maxLevel; lc > level; lc--) {
      currObj = this.greedyClosest(vector, currObj, lc);
    }

    // Phase 2: Insert at each layer from min(level, maxLevel) down to 0
    for (let lc = Math.min(level, this.maxLevel); lc >= 0; lc--) {
      const maxM = lc === 0 ? this.M0 : this.M;
      const W = this.searchLayer(vector, currObj, this.efConstruction, lc);

      // Select closest maxM neighbors
      if (W.length > maxM) {
        W.sort((a, b) => a[1] - b[1]);
        W.length = maxM;
      }

      // Bidirectional connections
      const myAdj = this.neighbors[idx][lc];
      for (let i = 0; i < W.length; i++) {
        const nIdx = W[i][0];
        myAdj.push(nIdx);
        this.neighbors[nIdx][lc].push(idx);

        // Prune neighbor if over limit
        if (this.neighbors[nIdx][lc].length > maxM) {
          this.shrinkNeighbors(nIdx, lc, maxM);
        }
      }

      // Use closest as entry for next layer
      if (W.length > 0) {
        let bestDist = W[0][1];
        currObj = W[0][0];
        for (let i = 1; i < W.length; i++) {
          if (W[i][1] < bestDist) {
            bestDist = W[i][1];
            currObj = W[i][0];
          }
        }
      }
    }

    if (level > this.maxLevel) {
      this.entryPoint = idx;
      this.maxLevel = level;
    }
  }

  remove(id: string): void {
    const idx = this.idToIndex.get(id);
    if (idx === undefined) return;
    if (this.deleted[idx]) return;

    this.deleted[idx] = true;
    this.activeCount--;

    if (idx === this.entryPoint) {
      this.repairEntryPoint();
    }
  }

  search(query: Float32Array, k: number, threshold: number = 0.0): Array<{ id: string; score: number }> {
    if (this.entryPoint === -1 || this.activeCount === 0) return [];

    const ef = Math.max(this.efSearch, k);
    let currObj = this.entryPoint;

    // Traverse from top layer to layer 1
    for (let lc = this.maxLevel; lc > 0; lc--) {
      currObj = this.greedyClosest(query, currObj, lc);
    }

    // Search layer 0
    const W = this.searchLayer(query, currObj, ef, 0);

    // Convert to results, filter deleted, apply threshold
    const results: Array<{ id: string; score: number }> = [];
    for (let i = 0; i < W.length; i++) {
      const nIdx = W[i][0];
      if (this.deleted[nIdx]) continue;
      const score = 1 - W[i][1]; // dist -> similarity
      if (score >= threshold) {
        results.push({ id: this.ids[nIdx], score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, k);
  }

  size(): number {
    return this.activeCount;
  }

  // ─── Serialization ──────────────────────────────────────────────────────────

  serialize(): Buffer {
    const data: SerializedIndex = {
      version: 1,
      M: this.M,
      efConstruction: this.efConstruction,
      efSearch: this.efSearch,
      dimensions: this.dimensions,
      entryPoint: this.entryPoint,
      maxLevel: this.maxLevel,
      nodes: this.ids.map((id, i) => ({
        id,
        vector: Array.from(this.vectors[i]),
        level: this.levels[i],
        neighbors: this.neighbors[i],
        deleted: this.deleted[i],
      })),
    };
    return Buffer.from(JSON.stringify(data));
  }

  static deserialize(buffer: Buffer): HNSWIndex {
    const data: SerializedIndex = JSON.parse(buffer.toString());
    const index = new HNSWIndex({
      M: data.M,
      efConstruction: data.efConstruction,
      efSearch: data.efSearch,
      dimensions: data.dimensions,
    });

    index.entryPoint = data.entryPoint;
    index.maxLevel = data.maxLevel;

    for (const n of data.nodes) {
      const idx = index.ids.length;
      index.ids.push(n.id);
      index.vectors.push(new Float32Array(n.vector));
      index.levels.push(n.level);
      index.deleted.push(n.deleted);
      index.neighbors.push(n.neighbors.map((arr) => [...arr]));
      if (!n.deleted) {
        index.idToIndex.set(n.id, idx);
        index.activeCount++;
      }
    }

    return index;
  }

  /** Set efSearch dynamically (useful for tuning recall vs speed) */
  setEfSearch(ef: number): void {
    this.efSearch = ef;
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  private randomLevel(): number {
    const r = Math.random() || 1e-10;
    return Math.min(Math.floor(-Math.log(r) * this.mL), 16);
  }

  /**
   * Compute distance (1 - dot product) for normalized vectors.
   * Unrolled 8x for V8 optimization.
   */
  private distance(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    const len = a.length;
    let i = 0;
    for (; i + 7 < len; i += 8) {
      dot +=
        a[i] * b[i] +
        a[i + 1] * b[i + 1] +
        a[i + 2] * b[i + 2] +
        a[i + 3] * b[i + 3] +
        a[i + 4] * b[i + 4] +
        a[i + 5] * b[i + 5] +
        a[i + 6] * b[i + 6] +
        a[i + 7] * b[i + 7];
    }
    for (; i < len; i++) {
      dot += a[i] * b[i];
    }
    return 1 - dot;
  }

  /**
   * Greedy traversal: find closest node at a given layer.
   */
  private greedyClosest(query: Float32Array, entryIdx: number, layer: number): number {
    let currIdx = entryIdx;
    let currDist = this.distance(query, this.vectors[currIdx]);

    let improved = true;
    while (improved) {
      improved = false;
      const adj = this.neighbors[currIdx][layer];
      for (let i = 0; i < adj.length; i++) {
        const nIdx = adj[i];
        const d = this.distance(query, this.vectors[nIdx]);
        if (d < currDist) {
          currDist = d;
          currIdx = nIdx;
          improved = true;
        }
      }
    }
    return currIdx;
  }

  /**
   * Search layer using Algorithm 2 from the paper.
   * Returns array of [nodeIdx, distance] pairs (up to ef items).
   * Uses a flat array sorted approach instead of heap for better cache behavior.
   */
  private searchLayer(
    query: Float32Array,
    entryIdx: number,
    ef: number,
    layer: number,
  ): Array<[number, number]> {
    const entryDist = this.distance(query, this.vectors[entryIdx]);

    // Use arrays: candidates to explore (sorted by distance asc)
    // and results (best ef found, sorted by distance asc)
    // We use a simple visited set and two working lists.

    const visited = new Set<number>();
    visited.add(entryIdx);

    // Candidates: [idx, dist] - items to explore, min-dist first
    let candidates: Array<[number, number]> = [[entryIdx, entryDist]];
    // Results: [idx, dist] - best found so far
    let results: Array<[number, number]> = [[entryIdx, entryDist]];
    let worstResultDist = entryDist;

    while (candidates.length > 0) {
      // Pop closest candidate
      const last = candidates.length - 1;
      const curr = candidates[last];
      candidates.length = last;

      // If closest candidate is worse than worst result, stop
      if (curr[1] > worstResultDist && results.length >= ef) {
        break;
      }

      // Explore neighbors at this layer
      const adj = this.neighbors[curr[0]][layer];
      for (let i = 0; i < adj.length; i++) {
        const nIdx = adj[i];
        if (visited.has(nIdx)) continue;
        visited.add(nIdx);

        const d = this.distance(query, this.vectors[nIdx]);

        if (d < worstResultDist || results.length < ef) {
          // Insert into candidates (maintain sorted desc so pop from end = min)
          // Binary search for insertion position (descending order)
          let lo = 0, hi = candidates.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (candidates[mid][1] > d) lo = mid + 1;
            else hi = mid;
          }
          candidates.splice(lo, 0, [nIdx, d]);

          // Insert into results (ascending order)
          lo = 0; hi = results.length;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (results[mid][1] < d) lo = mid + 1;
            else hi = mid;
          }
          results.splice(lo, 0, [nIdx, d]);

          // Trim results to ef
          if (results.length > ef) {
            results.length = ef;
          }
          worstResultDist = results[results.length - 1][1];
        }
      }
    }

    return results;
  }

  /**
   * Shrink a node's neighbor list to maxM by keeping closest.
   */
  private shrinkNeighbors(nodeIdx: number, layer: number, maxM: number): void {
    const adj = this.neighbors[nodeIdx][layer];
    if (adj.length <= maxM) return;

    const nodeVec = this.vectors[nodeIdx];
    // Compute distances and sort
    const withDist: Array<[number, number]> = new Array(adj.length);
    for (let i = 0; i < adj.length; i++) {
      withDist[i] = [adj[i], this.distance(nodeVec, this.vectors[adj[i]])];
    }
    withDist.sort((a, b) => a[1] - b[1]);

    // Keep closest maxM
    adj.length = maxM;
    for (let i = 0; i < maxM; i++) {
      adj[i] = withDist[i][0];
    }
  }

  /**
   * Find a new entry point after the current one is deleted.
   */
  private repairEntryPoint(): void {
    let bestIdx = -1;
    let bestLevel = -1;

    for (let i = 0; i < this.ids.length; i++) {
      if (!this.deleted[i] && this.levels[i] > bestLevel) {
        bestLevel = this.levels[i];
        bestIdx = i;
      }
    }

    this.entryPoint = bestIdx;
    this.maxLevel = bestLevel;
  }
}
