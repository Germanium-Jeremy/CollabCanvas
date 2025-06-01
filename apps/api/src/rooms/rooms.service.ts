import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  canEdit,
  canManage,
  canView,
  effectiveRole,
  type RoomAccessInfo,
  type RoomRole,
} from "@collabcanvas/shared";
import { randomBytes } from "node:crypto";
import { MAX_PENDING_INVITATIONS_PER_ROOM } from "@collabcanvas/shared";
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

/** URL-safe, unguessable invitation code (independent of the share-link code). */
function generateInvitationCode(): string {
  return `inv_${randomBytes(18).toString("base64url")}`;
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
   * Join a room.
   *
   * - Public rooms: any authenticated user joins explicitly as VIEWER.
   * - Private rooms: a matching invite code (i.e. a share link) joins the
   *   user as VIEWER — links never grant edit rights or change visibility.
   * - Owner-chosen roles come exclusively from email invitations
   *   (`createInvitation`), consumed when the recipient registers/exists.
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
      create: { roomId, userId, role: "VIEWER" },
      // Existing members keep their role — rejoining never self-promotes.
      update: {},
    });
    return { roomId, role: member.role as RoomRole };
  }

  /** Owner-only: invite a recipient with a pre-selected EDITOR/VIEWER role. */
  async createInvitation(
    room: RoomWithMembers,
    actorId: string,
    dto: { email: string; role: "EDITOR" | "VIEWER" },
  ) {
    this.assertAccess(room, actorId, "manage");
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && room.members.some((m) => m.userId === existing.id)) {
      throw new BadRequestException({ error: "already_a_member" });
    }

    const pendingCount = await this.prisma.roomInvitation.count({
      where: { roomId: room.id, status: "pending" },
    });
    if (pendingCount >= MAX_PENDING_INVITATIONS_PER_ROOM) {
      throw new BadRequestException({ error: "too_many_pending_invitations" });
    }

    const existingInvitation = await this.prisma.roomInvitation.findUnique({
      where: { roomId_email: { roomId: room.id, email } },
    });
    if (existingInvitation) {
      // Re-inviting refreshes the role and re-arms a revoked/accepted invite;
      // the code rotates so a stale copy cannot be redeemed with the new role.
      return this.prisma.roomInvitation.update({
        where: { id: existingInvitation.id },
        data: {
          role: dto.role,
          status: "pending",
          ...(existingInvitation.status === "pending" ? {} : { code: generateInvitationCode() }),
        },
      });
    }
    return this.prisma.roomInvitation.create({
      data: { roomId: room.id, email, code: generateInvitationCode(), role: dto.role, status: "pending" },
    });
  }

  /**
   * Consume a pending email invitation: grants the invited user the role the
   * owner chose, or 403 when the code/email pair does not match a live invite.
   */
  async redeemInvitation(roomId: string, userId: string, email: string, code: string): Promise<RoomRole> {
    const room = await this.getRoomOrThrow(roomId);
    const normalized = email.trim().toLowerCase();

    const invitation = await this.prisma.roomInvitation.findUnique({
      where: { roomId_email: { roomId: room.id, email: normalized } },
    });
    const valid =
      invitation && invitation.status === "pending" && invitation.code === code && invitation.email === normalized;
    if (!valid) {
      throw new ForbiddenException({ error: "invalid_invitation" });
    }

    await this.prisma.$transaction([
      this.prisma.roomMember.upsert({
        where: { roomId_userId: { roomId: room.id, userId } },
        create: { roomId: room.id, userId, role: invitation.role },
        // Already a member (e.g. via link first): an accepted email invite
        // still grants the owner's chosen role — that is the point of it.
        update: { role: invitation.role },
      }),
      this.prisma.roomInvitation.update({
        where: { id: invitation.id },
        data: { status: "accepted" },
      }),
    ]);
    return invitation.role;
  }

  /** Owner-only: pending invitations for the room. */
  async listInvitations(room: RoomWithMembers, actorId: string) {
    this.assertAccess(room, actorId, "manage");
    return this.prisma.roomInvitation.findMany({
      where: { roomId: room.id, status: "pending" },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    });
  }

  /** Owner-only: change a pending invitation's role (EDITOR <-> VIEWER). */
  async setInvitationRole(
    room: RoomWithMembers,
    actorId: string,
    invitationId: string,
    role: "EDITOR" | "VIEWER",
  ) {
    this.assertAccess(room, actorId, "manage");
    const invitation = await this.prisma.roomInvitation.findFirst({
      where: { id: invitationId, roomId: room.id },
    });
    if (!invitation) throw new NotFoundException({ error: "invitation_not_found" });
    return this.prisma.roomInvitation.update({
      where: { id: invitation.id },
      data: { role },
    });
  }

  /** Owner-only: revoke a pending invitation. */
  async revokeInvitation(room: RoomWithMembers, actorId: string, invitationId: string) {
    this.assertAccess(room, actorId, "manage");
    const invitation = await this.prisma.roomInvitation.findFirst({
      where: { id: invitationId, roomId: room.id },
    });
    if (!invitation) throw new NotFoundException({ error: "invitation_not_found" });
    await this.prisma.roomInvitation.update({
      where: { id: invitation.id },
      data: { status: "revoked" },
    });
    return { ok: true };
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
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!target) throw new NotFoundException({ error: "member_not_found" });
    // Upsert, not update: since opening a board no longer auto-joins, owners
    // promote implicit viewers (public visitors, link recipients) who may not
    // have a membership row yet. Promotion is the explicit grant.
    await this.prisma.roomMember.upsert({
      where: { roomId_userId: { roomId: room.id, userId: dto.userId } },
      create: { roomId: room.id, userId: dto.userId, role: dto.role },
      update: { role: dto.role },
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
