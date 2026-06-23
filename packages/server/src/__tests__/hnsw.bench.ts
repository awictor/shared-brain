/**
 * HNSW Benchmark & Recall Test
 *
 * Inserts 10,000 random 384-dim vectors, searches 100 queries, and compares
 * HNSW against brute-force for both speed and recall@10.
 *
 * Run: npx tsx src/__tests__/hnsw.bench.ts
 */

import { HNSWIndex } from '../hnsw.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomNormalizedVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    // Box-Muller for Gaussian
    const u1 = Math.random();
    const u2 = Math.random();
    v[i] = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function bruteForceSearch(
  vectors: Map<string, Float32Array>,
  query: Float32Array,
  k: number,
): Array<{ id: string; score: number }> {
  const results: Array<{ id: string; score: number }> = [];
  for (const [id, vector] of vectors) {
    results.push({ id, score: dotProduct(query, vector) });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, k);
}

// ─── Config ───────────────────────────────────────────────────────────────────

const NUM_VECTORS = 10_000;
const NUM_QUERIES = 100;
const DIM = 384;
const K = 10;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`HNSW Benchmark: ${NUM_VECTORS} vectors, ${DIM} dimensions, ${NUM_QUERIES} queries, k=${K}`);
  console.log('─'.repeat(70));

  // Generate data
  console.log('Generating random vectors...');
  const vectors = new Map<string, Float32Array>();
  const ids: string[] = [];
  for (let i = 0; i < NUM_VECTORS; i++) {
    const id = `vec_${i}`;
    ids.push(id);
    vectors.set(id, randomNormalizedVector(DIM));
  }

  const queries: Float32Array[] = [];
  for (let i = 0; i < NUM_QUERIES; i++) {
    queries.push(randomNormalizedVector(DIM));
  }

  // ─── HNSW Insert ────────────────────────────────────────────────────────────
  console.log('\n[HNSW] Inserting vectors...');
  const hnsw = new HNSWIndex({ M: 16, efConstruction: 200, efSearch: 50, dimensions: DIM });

  const insertStart = performance.now();
  for (const [id, vec] of vectors) {
    hnsw.add(id, vec);
  }
  const insertTime = performance.now() - insertStart;
  console.log(`[HNSW] Insert time: ${insertTime.toFixed(1)}ms (${(insertTime / NUM_VECTORS).toFixed(3)}ms/vec)`);

  // ─── HNSW Search ────────────────────────────────────────────────────────────
  console.log('\n[HNSW] Searching...');
  const hnswResults: Array<Array<{ id: string; score: number }>> = [];

  const hnswSearchStart = performance.now();
  for (const query of queries) {
    hnswResults.push(hnsw.search(query, K));
  }
  const hnswSearchTime = performance.now() - hnswSearchStart;
  console.log(`[HNSW] Search time: ${hnswSearchTime.toFixed(1)}ms total, ${(hnswSearchTime / NUM_QUERIES).toFixed(3)}ms/query`);

  // ─── Brute-Force Search ─────────────────────────────────────────────────────
  console.log('\n[Brute-Force] Searching...');
  const bfResults: Array<Array<{ id: string; score: number }>> = [];

  const bfSearchStart = performance.now();
  for (const query of queries) {
    bfResults.push(bruteForceSearch(vectors, query, K));
  }
  const bfSearchTime = performance.now() - bfSearchStart;
  console.log(`[Brute-Force] Search time: ${bfSearchTime.toFixed(1)}ms total, ${(bfSearchTime / NUM_QUERIES).toFixed(3)}ms/query`);

  // ─── Recall@10 ──────────────────────────────────────────────────────────────
  let totalRecall = 0;
  for (let q = 0; q < NUM_QUERIES; q++) {
    const truthIds = new Set(bfResults[q].map((r) => r.id));
    const hnswIds = hnswResults[q].map((r) => r.id);
    let hits = 0;
    for (const id of hnswIds) {
      if (truthIds.has(id)) hits++;
    }
    totalRecall += hits / K;
  }
  const avgRecall = totalRecall / NUM_QUERIES;

  // ─── Serialization Test ─────────────────────────────────────────────────────
  console.log('\n[Serialization] Testing serialize/deserialize...');
  const serStart = performance.now();
  const serialized = hnsw.serialize();
  const serTime = performance.now() - serStart;

  const deserStart = performance.now();
  const restored = HNSWIndex.deserialize(serialized);
  const deserTime = performance.now() - deserStart;

  // Verify restored index works
  const restoredResults = restored.search(queries[0], K);
  const restoredRecall = (() => {
    const truthIds = new Set(bfResults[0].map((r) => r.id));
    let hits = 0;
    for (const r of restoredResults) {
      if (truthIds.has(r.id)) hits++;
    }
    return hits / K;
  })();

  // ─── Deletion Test ──────────────────────────────────────────────────────────
  console.log('\n[Deletion] Testing remove...');
  const deleteCount = 1000;
  const delStart = performance.now();
  for (let i = 0; i < deleteCount; i++) {
    hnsw.remove(ids[i]);
  }
  const delTime = performance.now() - delStart;
  const sizeAfterDelete = hnsw.size();

  // ─── Results ────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('RESULTS');
  console.log('═'.repeat(70));
  console.log(`Vectors:              ${NUM_VECTORS}`);
  console.log(`Dimensions:           ${DIM}`);
  console.log(`Queries:              ${NUM_QUERIES}`);
  console.log(`k:                    ${K}`);
  console.log('─'.repeat(70));
  console.log(`HNSW insert:          ${insertTime.toFixed(1)}ms (${(insertTime / NUM_VECTORS).toFixed(3)}ms/vec)`);
  console.log(`HNSW search:          ${hnswSearchTime.toFixed(1)}ms (${(hnswSearchTime / NUM_QUERIES).toFixed(3)}ms/query)`);
  console.log(`Brute-force search:   ${bfSearchTime.toFixed(1)}ms (${(bfSearchTime / NUM_QUERIES).toFixed(3)}ms/query)`);
  console.log(`Speedup:              ${(bfSearchTime / hnswSearchTime).toFixed(1)}x`);
  console.log('─'.repeat(70));
  console.log(`Recall@10:            ${(avgRecall * 100).toFixed(1)}% ${avgRecall > 0.9 ? '✓ PASS' : '✗ FAIL (< 90%)'}`);
  console.log('─'.repeat(70));
  console.log(`Serialize:            ${serTime.toFixed(1)}ms (${(serialized.length / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Deserialize:          ${deserTime.toFixed(1)}ms`);
  console.log(`Restored recall:      ${(restoredRecall * 100).toFixed(1)}%`);
  console.log('─'.repeat(70));
  console.log(`Delete ${deleteCount} nodes:     ${delTime.toFixed(1)}ms`);
  console.log(`Size after delete:    ${sizeAfterDelete} (expected ${NUM_VECTORS - deleteCount})`);
  console.log('═'.repeat(70));

  // Exit with error if recall is too low
  if (avgRecall < 0.9) {
    console.error('\nFAILED: Recall@10 is below 0.9 threshold');
    process.exit(1);
  }

  if (sizeAfterDelete !== NUM_VECTORS - deleteCount) {
    console.error('\nFAILED: Size after deletion is incorrect');
    process.exit(1);
  }

  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
