// Models
export {
  type HLC,
  MemoryScope,
  MemoryType,
  type MemorySource,
  type MemoryRelation,
  type Memory,
  type MemoryOperation,
  type User,
  type Team,
  type TeamMembership,
  type Org,
  type ScopeFilter,
  type PermissionCheck,
  checkPermission,
} from './models/index.js';

// CRDT
export {
  HybridLogicalClock,
  type HLCState,
  mergeLWW,
  createLWWField,
  type LWWField,
  ORSet,
  type ORSetEntry,
  type ORSetJSON,
} from './crdt/index.js';

// Store
export { SqliteStore, type MemoryFilters, type SortOrder } from './store/index.js';
export { MigrationRunner } from './store/migrations/runner.js';

// Embeddings
export { EmbeddingEngine, cosineSimilarity, dotProduct, VectorIndex, type SearchResult } from './embeddings/index.js';
