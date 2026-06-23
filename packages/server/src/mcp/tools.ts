/**
 * MCP tool registration — all 11 SharedBrain tools.
 *
 * Each tool has a Zod-validated input schema and delegates to MemoryHandler.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MemoryHandler, Store } from './handler.js';
import type { AutoEnhancer } from '../auto-enhance.js';

export interface ToolDependencies {
  handler: MemoryHandler;
  store: Store;
  autoEnhancer?: AutoEnhancer;
}

export function registerTools(server: McpServer, deps: ToolDependencies): void {
  const { handler, store, autoEnhancer } = deps;

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
      // Auto-enhance: fill in title/type/tags/scope/relations if not provided
      const enhanced = autoEnhancer ? await autoEnhancer.enhance(params) : params;
      const result = await handler.handleStore(enhanced);
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
    'List memories with filtering and pagination. Unlike search, this does NOT use semantic similarity — it returns memories by recency or filter criteria. Use mine=true to only show your own memories.',
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
      mine: z.boolean().default(false).describe('If true, only return memories authored by the current user.'),
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

  // ─── memory_checkin ────────────────────────────────────────────────────────

  server.tool(
    'memory_checkin',
    'Load context at conversation start. Returns recent activity, active projects, pending actions, and cross-agent updates. Call this at the beginning of a session to get oriented.',
    {
      limit: z.number().default(5).describe('How many recent memories to include'),
      since: z.string().optional().describe('Only show activity since this ISO date'),
    },
    async (params) => {
      const now = new Date();
      const sinceDate = params.since || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const limit = params.limit ?? 5;

      // Last N memories (across all agents)
      const recentResult = await handler.handleList({
        sort: 'newest',
        limit,
        offset: 0,
      });

      // Memories from today (or since the provided date)
      const todayResult = await handler.handleList({
        sort: 'newest',
        limit: 50,
        offset: 0,
        filters: { since: sinceDate },
      });

      // Active projects: tags with > 3 memories
      const allTags = await store.getAllTags();
      const activeProjects = allTags.filter((t) => t.count > 3);

      // Pending action items: type=procedure or tag containing "action"
      const procedureResult = await handler.handleList({
        sort: 'newest',
        limit: 20,
        offset: 0,
        filters: { types: ['procedure'] },
      });
      const actionTagResult = await handler.handleList({
        sort: 'newest',
        limit: 20,
        offset: 0,
        filters: { tags: ['action', 'action-item', 'todo', 'task'] },
      });
      const actionIds = new Set<string>();
      const pendingActions = [...procedureResult.memories, ...actionTagResult.memories].filter((m) => {
        if (actionIds.has(m.id)) return false;
        actionIds.add(m.id);
        return true;
      });

      // Cross-agent activity: memories stored by non-local agents
      const crossAgentResult = await handler.handleList({
        sort: 'newest',
        limit: 20,
        offset: 0,
      });
      const crossAgentActivity = crossAgentResult.memories.filter(
        (m) => m.source?.agent && m.source.agent !== 'local',
      );

      // Others' memories: memories not authored by the current user
      const othersMemories = recentResult.memories.filter((m) => !m.isOwner);

      // Sync status for total count + last sync time
      const syncStatus = await handler.handleSyncStatus();

      const checkin = {
        recentMemories: recentResult.memories,
        todayMemories: todayResult.memories,
        yourMemories: recentResult.memories.filter((m) => m.isOwner),
        othersMemories,
        activeProjects,
        pendingActions,
        crossAgentActivity,
        totalCount: recentResult.total,
        lastSyncTime: syncStatus.lastSyncTime,
        generatedAt: now.toISOString(),
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(checkin) }],
      };
    },
  );

  // ─── memory_history ────────────────────────────────────────────────────────

  server.tool(
    'memory_history',
    'Get the full version history for a memory, showing all edits and who made them.',
    {
      id: z.string().describe('Memory UUID.'),
      limit: z.number().default(50).describe('Max number of versions to return.'),
    },
    async (params) => {
      const versionManager = (store as any).versionManager;
      if (!versionManager) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Version history not available.' }) }],
          isError: true,
        };
      }

      const history = versionManager.getHistory(params.id, params.limit);

      if (!history || history.length === 0) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'No version history found for this memory.' }) }],
          isError: true,
        };
      }

      // Format for display
      const formatted = history.map((v: any) => ({
        version: v.version,
        changeType: v.changeType,
        changedBy: v.changedBy,
        changedAt: v.changedAt,
        contentSnippet: v.content.slice(0, 100) + (v.content.length > 100 ? '...' : ''),
        title: v.title,
        type: v.type,
        tags: JSON.parse(v.tagsJson || '[]'),
      }));

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ history: formatted, count: history.length }) }],
      };
    },
  );
}
