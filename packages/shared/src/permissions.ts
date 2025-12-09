import type { RoomRole } from "./types";

export interface RoomAccessInfo {
  isPublic: boolean;
  deletedAt?: Date | string | null;
  ownerId: string;
  members: { userId: string; role: RoomRole }[];
}

/**
 * Resolve a user's effective role in a room.
 *
 * Rules:
 * - Deleted rooms grant no access to anyone.
 * - Explicit membership always wins (including VIEWER on public rooms).
 * - The owner is implicitly OWNER even if the membership row is missing.
 * - Public rooms grant VIEWER to authenticated non-members.
 */
export function effectiveRole(room: RoomAccessInfo, userId: string | null): RoomRole | null {
  if (room.deletedAt) return null;
  if (userId && room.members.some((m) => m.userId === userId)) {
    return room.members.find((m) => m.userId === userId)!.role;
  }
  if (userId && room.ownerId === userId) return "OWNER";
  if (userId && room.isPublic) return "VIEWER";
  return null;
}

export function canView(room: RoomAccessInfo, userId: string | null): boolean {
  return effectiveRole(room, userId) !== null;
}

export function canEdit(room: RoomAccessInfo, userId: string | null): boolean {
  const role = effectiveRole(room, userId);
  return role === "OWNER" || role === "EDITOR";
}

export function canManage(room: RoomAccessInfo, userId: string | null): boolean {
  return effectiveRole(room, userId) === "OWNER";
}
