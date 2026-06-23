/**
 * A user identity in the system.
 */
export interface User {
  /** UUIDv7 */
  id: string;

  /** Display name */
  name: string;

  /** Email (used for OAuth identity) */
  email: string;

  /** Node ID for HLC (short hash of user ID + device) */
  nodeId: string;

  /** Teams this user belongs to */
  teams: TeamMembership[];

  /** Org this user belongs to */
  orgId: string | null;

  /** Auth token hash (for simple token auth) */
  tokenHash: string | null;

  createdAt: string;
}

/**
 * A team grouping within an org.
 */
export interface Team {
  id: string;
  name: string;
  orgId: string;
  createdAt: string;
}

/**
 * A user's membership in a team.
 */
export interface TeamMembership {
  teamId: string;
  role: 'admin' | 'member' | 'readonly';
  joinedAt: string;
}

/**
 * An organization — top-level container.
 */
export interface Org {
  id: string;
  name: string;
  createdAt: string;
}
