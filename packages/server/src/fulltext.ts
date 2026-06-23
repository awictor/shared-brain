/**
 * FullTextIndex — BM25-style keyword search for SharedBrain memories.
 *
 * Maintains an inverted index mapping tokens → memory IDs with TF-IDF scoring.
 * Used as a fallback when semantic search doesn't surface the right results.
 */

interface TokenStats {
  docFreq: number; // How many documents contain this token
}

interface DocTokens {
  content: Map<string, number>; // token → term frequency in content
  title: Map<string, number>; // token → term frequency in title
  tags: Set<string>; // tags (exact match)
  totalTokens: number; // Total token count for normalization
}

export class FullTextIndex {
  private docs = new Map<string, DocTokens>(); // memory ID → tokenized content
  private tokenStats = new Map<string, TokenStats>(); // token → global stats
  private totalDocs = 0;

  /**
   * Add a memory to the full-text index.
   */
  add(id: string, content: string, title?: string, tags?: string[]): void {
    // Remove existing entry if present (for updates)
    this.remove(id);

    const contentTokens = this.tokenize(content);
    const titleTokens = title ? this.tokenize(title) : new Map<string, number>();
    const tagSet = new Set(tags ?? []);

    const docTokens: DocTokens = {
      content: contentTokens,
      title: titleTokens,
      tags: tagSet,
      totalTokens: [...contentTokens.values()].reduce((a, b) => a + b, 0) +
                    [...titleTokens.values()].reduce((a, b) => a + b, 0),
    };

    this.docs.set(id, docTokens);
    this.totalDocs++;

    // Update global token stats
    const allTokens = new Set([...contentTokens.keys(), ...titleTokens.keys()]);
    for (const token of allTokens) {
      const stats = this.tokenStats.get(token);
      if (stats) {
        stats.docFreq++;
      } else {
        this.tokenStats.set(token, { docFreq: 1 });
      }
    }
  }

  /**
   * Remove a memory from the index.
   */
  remove(id: string): void {
    const doc = this.docs.get(id);
    if (!doc) return;

    // Decrement token stats
    const allTokens = new Set([...doc.content.keys(), ...doc.title.keys()]);
    for (const token of allTokens) {
      const stats = this.tokenStats.get(token);
      if (stats) {
        stats.docFreq--;
        if (stats.docFreq === 0) {
          this.tokenStats.delete(token);
        }
      }
    }

    this.docs.delete(id);
    this.totalDocs--;
  }

  /**
   * BM25-style keyword search.
   *
   * Returns memory IDs sorted by relevance score.
   * Scoring:
   * - IDF: log((N - df + 0.5) / (df + 0.5)) — higher for rare terms
   * - TF: (tf * (k1 + 1)) / (tf + k1) — diminishing returns for repeated terms
   * - Title match worth 2x, tag match worth 3x
   */
  search(query: string, limit: number = 10): Array<{ id: string; score: number }> {
    const queryTokens = this.tokenize(query);
    if (queryTokens.size === 0) return [];

    const scores = new Map<string, number>();

    // BM25 parameters
    const k1 = 1.2; // Term saturation parameter

    for (const [id, doc] of this.docs.entries()) {
      let score = 0;

      for (const [queryToken, _] of queryTokens) {
        // Check content
        const contentTf = doc.content.get(queryToken) ?? 0;
        if (contentTf > 0) {
          const idf = this.computeIDF(queryToken);
          const bm25 = idf * (contentTf * (k1 + 1)) / (contentTf + k1);
          score += bm25;
        }

        // Check title (2x weight)
        const titleTf = doc.title.get(queryToken) ?? 0;
        if (titleTf > 0) {
          const idf = this.computeIDF(queryToken);
          const bm25 = idf * (titleTf * (k1 + 1)) / (titleTf + k1);
          score += bm25 * 2.0;
        }

        // Check tags (3x weight, exact match only)
        if (doc.tags.has(queryToken)) {
          const idf = this.computeIDF(queryToken);
          score += idf * 3.0;
        }
      }

      if (score > 0) {
        scores.set(id, score);
      }
    }

    // Sort by score descending and limit
    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id, score]) => ({ id, score }));

    return sorted;
  }

  /**
   * Number of indexed documents.
   */
  size(): number {
    return this.totalDocs;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Tokenize text: lowercase, split on non-alphanumeric, count frequencies.
   */
  private tokenize(text: string): Map<string, number> {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ') // Strip punctuation
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const counts = new Map<string, number>();
    for (const token of tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Compute Inverse Document Frequency (IDF) for a token.
   * IDF = log((N - df + 0.5) / (df + 0.5))
   */
  private computeIDF(token: string): number {
    const stats = this.tokenStats.get(token);
    if (!stats) return 0;

    const N = this.totalDocs;
    const df = stats.docFreq;

    // Prevent log(0) or negative
    if (df >= N) return 0;

    return Math.log((N - df + 0.5) / (df + 0.5));
  }
}
