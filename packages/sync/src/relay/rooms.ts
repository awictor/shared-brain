/**
 * RoomManager — manages WebSocket connections grouped by scope (team/org).
 *
 * Each client subscribes to one or more "rooms" based on their scopes:
 * - Personal room: "personal:{userId}" (only their own ops)
 * - Team room: "team:{teamId}"
 * - Org room: "org:{orgId}"
 *
 * When an operation arrives, the RoomManager broadcasts it to all connections
 * subscribed to the relevant rooms (excluding the sender).
 */

import type WebSocket from 'ws';
import type { MemoryOperation } from '@shared-brain/core';
import { encode } from '../protocol/messages.js';

export interface RoomMember {
  ws: WebSocket;
  userId: string;
  nodeId: string;
  rooms: Set<string>;
}

export class RoomManager {
  /**
   * Map of room name → set of WebSocket connections in that room.
   */
  private rooms: Map<string, Set<WebSocket>> = new Map();

  /**
   * Map of WebSocket → member metadata (for cleanup on disconnect).
   */
  private members: Map<WebSocket, RoomMember> = new Map();

  /**
   * Add a connection to rooms based on the user's scopes.
   *
   * @param ws - The WebSocket connection
   * @param userId - The authenticated user's ID
   * @param nodeId - The user's node ID (for HLC)
   * @param scopes - Which scopes to subscribe to
   */
  join(
    ws: WebSocket,
    userId: string,
    nodeId: string,
    scopes: { personal: boolean; teamIds: string[]; orgId?: string | null },
  ): void {
    const memberRooms = new Set<string>();

    // Always join personal room
    if (scopes.personal) {
      const room = `personal:${userId}`;
      this.addToRoom(room, ws);
      memberRooms.add(room);
    }

    // Join team rooms
    for (const teamId of scopes.teamIds) {
      const room = `team:${teamId}`;
      this.addToRoom(room, ws);
      memberRooms.add(room);
    }

    // Join org room
    if (scopes.orgId) {
      const room = `org:${scopes.orgId}`;
      this.addToRoom(room, ws);
      memberRooms.add(room);
    }

    this.members.set(ws, { ws, userId, nodeId, rooms: memberRooms });
  }

  /**
   * Remove a connection from all rooms (on disconnect).
   */
  leave(ws: WebSocket): void {
    const member = this.members.get(ws);
    if (!member) return;

    for (const room of member.rooms) {
      const roomSet = this.rooms.get(room);
      if (roomSet) {
        roomSet.delete(ws);
        if (roomSet.size === 0) {
          this.rooms.delete(room);
        }
      }
    }

    this.members.delete(ws);
  }

  /**
   * Broadcast an operation to all connections in the target scopes,
   * except the sender.
   *
   * @param op - The operation to broadcast
   * @param senderWs - The sender's WebSocket (excluded from broadcast)
   */
  broadcast(op: MemoryOperation, senderWs: WebSocket): void {
    const targetRooms = this.getTargetRooms(op);
    const sent = new Set<WebSocket>(); // Avoid sending duplicates

    const message = encode({ type: 'LIVE_OP', op });

    for (const room of targetRooms) {
      const roomSet = this.rooms.get(room);
      if (!roomSet) continue;

      for (const ws of roomSet) {
        if (ws === senderWs) continue;
        if (sent.has(ws)) continue;
        if (ws.readyState !== 1 /* WebSocket.OPEN */) continue;

        ws.send(message);
        sent.add(ws);
      }
    }
  }

  /**
   * Get the number of active connections.
   */
  connectionCount(): number {
    return this.members.size;
  }

  /**
   * Get the number of active rooms.
   */
  roomCount(): number {
    return this.rooms.size;
  }

  /**
   * Get all members in a specific room.
   */
  getRoomMembers(room: string): RoomMember[] {
    const roomSet = this.rooms.get(room);
    if (!roomSet) return [];

    const members: RoomMember[] = [];
    for (const ws of roomSet) {
      const member = this.members.get(ws);
      if (member) members.push(member);
    }
    return members;
  }

  /**
   * Get the member metadata for a specific connection.
   */
  getMember(ws: WebSocket): RoomMember | undefined {
    return this.members.get(ws);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private addToRoom(room: string, ws: WebSocket): void {
    let roomSet = this.rooms.get(room);
    if (!roomSet) {
      roomSet = new Set();
      this.rooms.set(room, roomSet);
    }
    roomSet.add(ws);
  }

  /**
   * Determine which rooms an operation should be broadcast to,
   * based on its scope and team/org IDs.
   */
  private getTargetRooms(op: MemoryOperation): string[] {
    const rooms: string[] = [];

    switch (op.scope) {
      case 'personal':
        // Personal ops go to the author's personal room
        rooms.push(`personal:${op.authorId}`);
        break;
      case 'team':
        if (op.teamId) {
          rooms.push(`team:${op.teamId}`);
        }
        break;
      case 'org':
        if (op.orgId) {
          rooms.push(`org:${op.orgId}`);
        }
        break;
    }

    return rooms;
  }
}
