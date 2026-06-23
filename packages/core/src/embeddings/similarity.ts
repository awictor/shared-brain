/**
 * Compute cosine similarity between two vectors.
 * If vectors are pre-normalized (unit length), this is equivalent to dot product.
 *
 * @returns similarity score in range [-1, 1] (1 = identical, 0 = orthogonal, -1 = opposite)
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;

  return dot / denom;
}

/**
 * Compute dot product between two vectors.
 * Use when vectors are already normalized (faster than cosineSimilarity).
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

export interface SearchResult {
  id: string;
  score: number;
}

/**
 * In-memory brute-force vector index.
 * Stores vectors and supports k-nearest-neighbor search via cosine similarity.
 *
 * For < 100k vectors, brute-force is fast enough (~5ms).
 * For larger collections, replace with HNSW.
 */
export class VectorIndex {
  private vectors: Map<string, Float32Array> = new Map();

  /**
   * Add a vector to the index.
   */
  add(id: string, vector: Float32Array): void {
    this.vectors.set(id, vector);
  }

  /**
   * Remove a vector from the index.
   */
  remove(id: string): void {
    this.vectors.delete(id);
  }

  /**
   * Check if a vector exists in the index.
   */
  has(id: string): boolean {
    return this.vectors.has(id);
  }

  /**
   * Get a vector by ID.
   */
  get(id: string): Float32Array | undefined {
    return this.vectors.get(id);
  }

  /**
   * Find k nearest neighbors by cosine similarity.
   * Returns results sorted by descending similarity score.
   *
   * @param query - The query vector
   * @param k - Maximum number of results
   * @param threshold - Minimum similarity score (default: 0.0)
   * @param filterIds - Optional set of IDs to restrict search to
   */
  search(
    query: Float32Array,
    k: number,
    threshold: number = 0.0,
    filterIds?: Set<string>
  ): SearchResult[] {
    const results: SearchResult[] = [];

    for (const [id, vector] of this.vectors) {
      if (filterIds && !filterIds.has(id)) continue;

      const score = cosineSimilarity(query, vector);
      if (score >= threshold) {
        results.push({ id, score });
      }
    }

    // Sort descending by score
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, k);
  }

  /**
   * Get the number of vectors in the index.
   */
  get size(): number {
    return this.vectors.size;
  }

  /**
   * Clear all vectors from the index.
   */
  clear(): void {
    this.vectors.clear();
  }

  /**
   * Get all IDs in the index.
   */
  ids(): string[] {
    return Array.from(this.vectors.keys());
  }
}
