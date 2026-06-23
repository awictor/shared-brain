import { MemoryScope } from './memory.js';
import type { User } from './user.js';

/**
 * Filter describing which scopes to include in a query.
 */
export interface ScopeFilter {
  /** Include personal memories (own only) */
  personal: boolean;
  /** Include team memories (specify team IDs, or empty = all user's teams) */
  teamIds: string[];
  /** Include org-wide memories */
  org: boolean;
}

/**
 * Input to the permission check function.
 */
export interface PermissionCheck {
  userId: string;
  memoryScope: MemoryScope;
  memoryTeamId: string | null;
  memoryOrgId: string | null;
  memoryAuthorId: string;
  operation: 'read' | 'write' | 'delete' | 'admin';
}

/**
 * Permission rules:
 * - Personal: only author can read/write/delete
 * - Team: any team member can read; author + team admins can write/delete
 * - Org: any org member can read; author + org admins can write/delete
 */
export function checkPermission(check: PermissionCheck, user: User): boolean {
  const { memoryScope, memoryTeamId, memoryOrgId, memoryAuthorId, operation } = check;

  // Author always has full access to their own memories
  if (user.id === memoryAuthorId) {
    return true;
  }

  switch (memoryScope) {
    case MemoryScope.Personal:
      // Only the author can access personal memories
      return false;

    case MemoryScope.Team: {
      if (!memoryTeamId) return false;

      // User must be a member of the team
      const membership = user.teams.find((t) => t.teamId === memoryTeamId);
      if (!membership) return false;

      // Read is allowed for any team member
      if (operation === 'read') return true;

      // Write/delete/admin requires admin role
      if (operation === 'write' || operation === 'delete' || operation === 'admin') {
        return membership.role === 'admin';
      }

      return false;
    }

    case MemoryScope.Org: {
      if (!memoryOrgId) return false;

      // User must belong to the same org
      if (user.orgId !== memoryOrgId) return false;

      // Read is allowed for any org member
      if (operation === 'read') return true;

      // Write/delete/admin: check if user is admin in any team within the org
      // (org-level admin is approximated by team admin status)
      if (operation === 'write' || operation === 'delete' || operation === 'admin') {
        return user.teams.some((t) => t.role === 'admin');
      }

      return false;
    }

    default:
      return false;
  }
}
