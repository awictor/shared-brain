/**
 * MCP resource registration — exposes read-only data views.
 *
 * Resources:
 *   sharedbrain://stats   — memory count by scope/type/sync
 *   sharedbrain://recent  — last 20 memories
 *   sharedbrain://tags    — all tags with counts
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Store } from './handler.js';

export interface ResourceDependencies {
  store: Store;
}

export function registerResources(server: McpServer, deps: ResourceDependencies): void {
  const { store } = deps;

  // ─── sharedbrain://stats ───────────────────────────────────────────────────

  server.resource(
    'sharedbrain://stats',
    'Memory Statistics',
    async () => {
      const total = await store.countMemories();
      const tags = await store.getAllTags();
      const pending = await store.getPendingOperations();
      const lastSync = await store.getLastSyncTime();

      const stats = {
        totalMemories: total,
        pendingSync: pending.length,
        lastSyncTime: lastSync,
        tagCount: tags.length,
      };

      return {
        contents: [
          {
            uri: 'sharedbrain://stats',
            mimeType: 'application/json',
            text: JSON.stringify(stats, null, 2),
          },
        ],
      };
    },
  );

  // ─── sharedbrain://recent ──────────────────────────────────────────────────

  server.resource(
    'sharedbrain://recent',
    'Recent Memories',
    async () => {
      const memories = await store.listMemories({
        sort: 'newest',
        limit: 20,
        offset: 0,
      });

      const clean = memories.map((m) => {
        const { embedding: _, ...rest } = m;
        return rest;
      });

      return {
        contents: [
          {
            uri: 'sharedbrain://recent',
            mimeType: 'application/json',
            text: JSON.stringify(clean, null, 2),
          },
        ],
      };
    },
  );

  // ─── sharedbrain://tags ────────────────────────────────────────────────────

  server.resource(
    'sharedbrain://tags',
    'All Tags',
    async () => {
      const tags = await store.getAllTags();

      return {
        contents: [
          {
            uri: 'sharedbrain://tags',
            mimeType: 'application/json',
            text: JSON.stringify(tags, null, 2),
          },
        ],
      };
    },
  );
}
