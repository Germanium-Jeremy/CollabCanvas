import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  canEdit,
  canManage,
  canView,
  effectiveRole,
  type RoomAccessInfo,
  type RoomRole,
} from "@collabcanvas/shared";
import type { Room, RoomMember } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type RoomWithMembers = Room & { members: RoomMember[] };

export function toAccessInfo(room: RoomWithMembers): RoomAccessInfo {
  return {
    isPublic: room.isPublic,
    deletedAt: room.deletedAt,
    ownerId: room.ownerId,
    members: room.members.map((m) => ({ userId: m.userId, role: m.role as RoomRole })),
  };
}

@Injectable()
export class RoomsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getRoomOrThrow(id: string): Promise<RoomWithMembers> {
    const room = await this.prisma.room.findUnique({ where: { id }, include: { members: true } });
    if (!room || room.deletedAt) throw new NotFoundException({ error: "room_not_found" });
    return room;
  }

  /** Throws unless the user holds the required access level on the room. */
  assertAccess(room: RoomWithMembers, userId: string, level: "view" | "edit" | "manage"): RoomRole {
    const access = toAccessInfo(room);
    const check = level === "view" ? canView : level === "edit" ? canEdit : canManage;
    if (!check(access, userId)) {
      throw new ForbiddenException({ error: level === "manage" ? "owner_only" : "insufficient_permissions" });
    }
    return effectiveRole(access, userId) as RoomRole;
  }

  async create(userId: string, dto: { name: string; isPublic: boolean }): Promise<RoomWithMembers> {
    return this.prisma.room.create({
      data: {
        name: dto.name,
        isPublic: dto.isPublic,
        ownerId: userId,
        members: { create: { userId, role: "OWNER" } },
      },
      include: { members: true },
    });
  }

  async listMine(userId: string) {
    const rooms = await this.prisma.room.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }],
      },
      orderBy: { updatedAt: "desc" },
      include: { members: { where: { userId } } },
      take: 50,
    });
    return rooms.map((room) => ({
      id: room.id,
      name: room.name,
      isPublic: room.isPublic,
      role: (room.members[0]?.role ?? "OWNER") as RoomRole,
      updatedAt: room.updatedAt,
    }));
  }

  async update(room: RoomWithMembers, userId: string, dto: { name?: string; isPublic?: boolean }) {
    this.assertAccess(room, userId, "manage");
    return this.prisma.room.update({ where: { id: room.id }, data: dto, include: { members: true } });
  }

  async softDelete(room: RoomWithMembers, userId: string): Promise<void> {
    this.assertAccess(room, userId, "manage");
    await this.prisma.room.update({ where: { id: room.id }, data: { deletedAt: new Date() } });
  }

  /**
   * Join a room: public rooms need no code, private rooms require a matching
   * invite code. Explicit joins grant EDITOR (owners keep OWNER).
   */
  async join(roomId: string, userId: string, code?: string): Promise<{ roomId: string; role: RoomRole }> {
    const room = await this.getRoomOrThrow(roomId);
    const role = effectiveRole(toAccessInfo(room), userId);
    if (role === "OWNER") return { roomId, role: "OWNER" };

    if (!room.isPublic && (!code || code !== room.inviteCode)) {
      throw new ForbiddenException({ error: "invite_code_required" });
    }

    const member = await this.prisma.roomMember.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId, role: "EDITOR" },
      update: {},
    });
    return { roomId, role: member.role as RoomRole };
  }

  async listMembers(room: RoomWithMembers) {
    const users = await this.prisma.user.findMany({
      where: { memberships: { some: { roomId: room.id } } },
      select: { id: true, name: true, email: true, image: true },
    });
    return room.members.map((m) => {
      const profile = users.find((u) => u.id === m.userId);
      return { userId: m.userId, role: m.role as RoomRole, name: profile?.name ?? null, email: profile?.email ?? null };
    });
  }

  async setMemberRole(room: RoomWithMembers, actorId: string, dto: { userId: string; role: RoomRole }) {
    this.assertAccess(room, actorId, "manage");
    if (dto.userId === actorId) {
      throw new BadRequestException({ error: "cannot_change_own_role" });
    }
    if (!room.members.some((m) => m.userId === dto.userId)) {
      throw new NotFoundException({ error: "member_not_found" });
    }
    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId: room.id, userId: dto.userId } },
      data: { role: dto.role },
    });
    return { ok: true };
  }

  /** Owners can remove anyone; members can remove themselves (leave). Owners cannot leave. */
  async removeMember(room: RoomWithMembers, actorId: string, targetId: string) {
    const isSelf = actorId === targetId;
    if (isSelf) {
      if (room.ownerId === actorId) {
        throw new BadRequestException({ error: "owner_cannot_leave" });
      }
    } else {
      this.assertAccess(room, actorId, "manage");
    }
    if (!room.members.some((m) => m.userId === targetId)) {
      throw new NotFoundException({ error: "member_not_found" });
    }
    await this.prisma.roomMember.delete({
      where: { roomId_userId: { roomId: room.id, userId: targetId } },
    });
    return { ok: true };
  }

  async report(room: RoomWithMembers, reporterId: string, dto: { reason: string; details?: string }) {
    await this.prisma.report.create({
      data: { roomId: room.id, reporterId, reason: dto.reason, details: dto.details },
    });
    return { ok: true };
  }

  async block(room: RoomWithMembers, actorId: string, blockedUserId: string) {
    this.assertAccess(room, actorId, "manage");
    await this.prisma.block.upsert({
      where: { roomId_blockedUserId: { roomId: room.id, blockedUserId } },
      create: { roomId: room.id, blockedUserId, createdById: actorId },
      update: {},
    });
    return { ok: true };
  }
}
