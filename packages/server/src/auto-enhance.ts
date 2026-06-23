/**
 * AutoEnhancer — wraps the memory handler to automatically organize every stored memory.
 *
 * On ingest (via MCP tool or webhook), the enhancer fills in missing metadata:
 * title, type, tags, scope, and relations — so users can store raw content
 * without worrying about classification.
 */

import type { Organizer } from './organizer.js';
import type { Store, Embeddings, VectorIndex, StoreParams } from './mcp/handler.js';

export class AutoEnhancer {
  constructor(
    private organizer: Organizer,
    private store: Store,
    private embeddings: Embeddings,
    private vectorIndex: VectorIndex,
  ) {}

  /**
   * Enhance a memory before storage:
   * - If no title → generate one
   * - If no type or type is 'fact' (default) → infer better type
   * - If no tags → extract them
   * - Always find and add relations to similar memories
   * - Infer scope if not explicitly set
   */
  async enhance(params: StoreParams): Promise<StoreParams> {
    const needsTitle = !params.title;
    const needsType = !params.type || params.type === 'fact';
    const needsTags = !params.tags || params.tags.length === 0;
    const needsScope = !params.scope || params.scope === 'personal';

    // Run the organizer to get inferred metadata
    const organized = await this.organizer.organize(
      params.content,
      needsTitle ? undefined : params.title,
      needsType ? undefined : params.type,
      needsTags ? undefined : params.tags,
      needsScope ? undefined : params.scope,
    );

    // Build enhanced params — only override fields that were missing/default
    const enhanced: StoreParams = { ...params };

    if (needsTitle) {
      enhanced.title = organized.title;
    }

    if (needsType) {
      enhanced.type = organized.type;
    }

    if (needsTags) {
      enhanced.tags = organized.tags;
    }

    if (needsScope) {
      enhanced.scope = organized.scope;
    }

    // Always merge inferred relations with any explicitly provided ones
    const existingRelations = params.relations ?? [];
    const existingTargetIds = new Set(existingRelations.map((r) => r.targetId));

    // Only add inferred relations that don't conflict with explicit ones
    const newRelations = organized.relations.filter(
      (r) => !existingTargetIds.has(r.targetId),
    );

    if (newRelations.length > 0) {
      enhanced.relations = [...existingRelations, ...newRelations];
    }

    return enhanced;
  }
}
