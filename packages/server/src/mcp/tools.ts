/**
 * MCP tool registration — all 10 SharedBrain tools.
 *
 * Each tool has a Zod-validated input schema and delegates to MemoryHandler.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryHandler } from './handler.js';

export interface ToolDependencies {
  handler: MemoryHandler;
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  const { handler } = deps;

  // ─── memory_store ──────────────────────────────────────────────────────────

  server.tool(
    'memory_store',
    'Store a new memory. Use this to save facts, decisions, procedures, preferences, or context that should be remembered.',
    {
      content: z.string().describe('The content of the memory. Be specific and self-contained.'),
      title: z.string().optional().describe('Optional short title/summary (< 100 chars).'),
      type: z.enum(['fact', 'procedure', 'decision', 'context', 'preference', 'reference']).describe('Category of memory.'),
      scope: z.enum(['personal', 'team', 'org']).default('personal').describe('Visibility scope.'),
      tags: z.array(z.string()).optional().describe('Tags for categorical filtering.'),
      relations: z.array(z.object({
        targetId: z.string(),
        type: z.enum(['supersedes', 'relates_to', 'contradicts', 'extends']),
      })).optional().describe('Links to related memories.'),
      source: z.object({
        type: z.string().optional(),
        agent: z.string().optional(),
        reference: z.string().optional(),
      }).optional().describe('Attribution for this memory.'),
    },
    async (params) => {
      const result = await handler.handleStore(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ─── memory_search ─────────────────────────────────────────────────────────

  server.tool(
    'memory_search',
    'Semantic search across memories. Returns the most relevant memories by meaning, not just keyword match.',
    {
      query: z.string().describe('Natural language search query.'),
      scope: z.object({
        personal: z.boolean().default(true),
        teamIds: z.array(z.string()).optional(),
        org: z.boolean().default(false),
      }).optional().describe('Which scopes to search.'),
      filters: z.object({
        types: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        authorId: z.string().optional(),
        since: z.string().optional().describe('ISO date — only memories after this date.'),
        before: z.string().optional().describe('ISO date — only memories before this date.'),
      }).optional(),
      limit: z.number().default(10).describe('Max results to return.'),
      threshold: z.number().default(0.3).describe('Minimum similarity score (0-1).'),
    },
    async (params) => {
      const results = await handler.handleSearch(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results) }],
      };
    },
  );

  // ─── memory_get ────────────────────────────────────────────────────────────

  server.tool(
    'memory_get',
    'Retrieve a specific memory by its ID.',
    {
      id: z.string().describe('Memory UUID.'),
    },
    async (params) => {
      const result = await handler.handleGet(params);
      if (!result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Memory not found.' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ─── memory_update ─────────────────────────────────────────────────────────

  server.tool(
    'memory_update',
    'Update an existing memory. Only provided fields will be changed.',
    {
      id: z.string().describe('Memory UUID to update.'),
      content: z.string().optional(),
      title: z.string().optional(),
      type: z.enum(['fact', 'procedure', 'decision', 'context', 'preference', 'reference']).optional(),
      scope: z.enum(['personal', 'team', 'org']).optional(),
      tags: z.object({
        add: z.array(z.string()).optional(),
        remove: z.array(z.string()).optional(),
      }).optional(),
      relations: z.object({
        add: z.array(z.object({
          targetId: z.string(),
          type: z.enum(['supersedes', 'relates_to', 'contradicts', 'extends']),
        })).optional(),
        remove: z.array(z.string()).optional().describe('Target IDs to unlink.'),
      }).optional(),
    },
    async (params) => {
      const result = await handler.handleUpdate(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ─── memory_delete ─────────────────────────────────────────────────────────

  server.tool(
    'memory_delete',
    'Soft-delete a memory. It will no longer appear in searches but can be recovered.',
    {
      id: z.string().describe('Memory UUID to delete.'),
    },
    async (params) => {
      const result = await handler.handleDelete(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        isError: !result.success,
      };
    },
  );

  // ─── memory_list ───────────────────────────────────────────────────────────

  server.tool(
    'memory_list',
    'List memories with filtering and pagination. Unlike search, this does NOT use semantic similarity — it returns memories by recency or filter criteria.',
    {
      scope: z.object({
        personal: z.boolean().default(true),
        teamIds: z.array(z.string()).optional(),
        org: z.boolean().default(false),
      }).optional(),
      filters: z.object({
        types: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        authorId: z.string().optional(),
        since: z.string().optional(),
        before: z.string().optional(),
      }).optional(),
      sort: z.enum(['newest', 'oldest', 'updated']).default('newest'),
      limit: z.number().default(20),
      offset: z.number().default(0),
    },
    async (params) => {
      const result = await handler.handleList(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ─── memory_relate ─────────────────────────────────────────────────────────

  server.tool(
    'memory_relate',
    'Find memories semantically related to a given memory ID. Useful for discovering connections.',
    {
      id: z.string().describe('Memory UUID to find relations for.'),
      limit: z.number().default(5),
      threshold: z.number().default(0.5),
    },
    async (params) => {
      const results = await handler.handleRelate(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results) }],
      };
    },
  );

  // ─── sync_status ───────────────────────────────────────────────────────────

  server.tool(
    'sync_status',
    'Get the current sync status — pending operations, connection state, last sync time.',
    {},
    async () => {
      const result = await handler.handleSyncStatus();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ─── memory_import ─────────────────────────────────────────────────────────

  server.tool(
    'memory_import',
    'Bulk import memories from a JSON array.',
    {
      memories: z.array(z.object({
        content: z.string(),
        title: z.string().optional(),
        type: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })).describe('Array of memories to import.'),
      scope: z.enum(['personal', 'team', 'org']).default('personal'),
    },
    async (params) => {
      const result = await handler.handleImport(params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    },
  );

  // ─── memory_export ─────────────────────────────────────────────────────────

  server.tool(
    'memory_export',
    'Export memories matching a filter as JSON or markdown.',
    {
      scope: z.object({
        personal: z.boolean().optional(),
        teamIds: z.array(z.string()).optional(),
        org: z.boolean().optional(),
      }).optional(),
      filters: z.object({
        types: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
      }).optional(),
      format: z.enum(['json', 'markdown']).default('json'),
    },
    async (params) => {
      const result = await handler.handleExport(params);
      return {
        content: [{ type: 'text' as const, text: result.data }],
      };
    },
  );
}
