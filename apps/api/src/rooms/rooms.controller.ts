import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import {
  createInvitationSchema,
  createRoomSchema,
  joinRoomSchema,
  redeemInvitationSchema,
  reportSchema,
  setInvitationRoleSchema,
  setMemberRoleSchema,
  updateRoomSchema,
  type CreateInvitationInput,
  type CreateRoomInput,
  type JoinRoomInput,
  type RedeemInvitationInput,
  type ReportInput,
  type SetInvitationRoleInput,
  type SetMemberRoleInput,
  type UpdateRoomInput,
} from "@collabcanvas/shared";
import { CurrentUser } from "../common/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { RoomsService } from "./rooms.service";

@Controller("rooms")
export class RoomsController {
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  @Post()
  create(@CurrentUser() user: { sub: string }, @Body(new ZodValidationPipe(createRoomSchema)) dto: CreateRoomInput) {
    return this.rooms.create(user.sub, dto);
  }

  @Get("mine")
  mine(@CurrentUser() user: { sub: string }) {
    return this.rooms.listMine(user.sub);
  }

  @Get(":id")
  async findOne(@CurrentUser() user: { sub: string }, @Param("id") id: string) {
    const room = await this.rooms.getRoomOrThrow(id);
    const role = this.rooms.assertAccess(room, user.sub, "view");
    return {
      id: room.id,
      name: room.name,
      isPublic: room.isPublic,
      ownerId: room.ownerId,
      // Invite codes are owner-only: any member with the code could mint
      // further memberships for a private room.
      inviteCode: !room.isPublic && role === "OWNER" ? room.inviteCode : null,
      role,
      // Distinguishes explicit VIEWER members from implicit public visitors —
      // the UI offers "Join board" only to the latter.
      isMember: room.members.some((m) => m.userId === user.sub),
      updatedAt: room.updatedAt,
    };
  }

  @Patch(":id")
  async update(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateRoomSchema)) dto: UpdateRoomInput,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.update(room, user.sub, dto);
  }

  @Delete(":id")
  async remove(@CurrentUser() user: { sub: string }, @Param("id") id: string) {
    const room = await this.rooms.getRoomOrThrow(id);
    await this.rooms.softDelete(room, user.sub);
    return { ok: true };
  }

  @Post(":id/join")
  async join(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(joinRoomSchema)) dto: JoinRoomInput,
  ) {
    return this.rooms.join(id, user.sub, dto.code);
  }

  /** Owner-only: invite a recipient with a chosen EDITOR/VIEWER role. */
  @Post(":id/invitations")
  async createInvitation(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createInvitationSchema)) dto: CreateInvitationInput,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.createInvitation(room, user.sub, dto);
  }

  /** Owner-only: pending invitations for the room. */
  @Get(":id/invitations")
  async listInvitations(@CurrentUser() user: { sub: string }, @Param("id") id: string) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.listInvitations(room, user.sub);
  }

  /** Owner-only: change a pending invitation's role. */
  @Patch(":id/invitations/:invitationId")
  async setInvitationRole(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Param("invitationId") invitationId: string,
    @Body(new ZodValidationPipe(setInvitationRoleSchema)) dto: SetInvitationRoleInput,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.setInvitationRole(room, user.sub, invitationId, dto.role);
  }

  /** Owner-only: revoke a pending invitation. */
  @Delete(":id/invitations/:invitationId")
  async revokeInvitation(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Param("invitationId") invitationId: string,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.revokeInvitation(room, user.sub, invitationId);
  }

  /** Any authenticated user: consume an email invitation (email + code). */
  @Post(":id/invitations/redeem")
  redeemInvitation(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(redeemInvitationSchema)) dto: RedeemInvitationInput,
  ) {
    return this.rooms.redeemInvitation(id, user.sub, dto.email, dto.code).then((role) => ({ roomId: id, role }));
  }

  @Get(":id/members")
  async members(@CurrentUser() user: { sub: string }, @Param("id") id: string) {
    const room = await this.rooms.getRoomOrThrow(id);
    this.rooms.assertAccess(room, user.sub, "view");
    return this.rooms.listMembers(room);
  }

  @Patch(":id/members")
  async setMemberRole(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(setMemberRoleSchema)) dto: SetMemberRoleInput,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.setMemberRole(room, user.sub, dto);
  }

  @Delete(":id/members/:userId")
  async removeMember(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Param("userId") targetId: string,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.removeMember(room, user.sub, targetId);
  }

  @Post(":id/report")
  async report(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(reportSchema)) dto: ReportInput,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    this.rooms.assertAccess(room, user.sub, "view");
    return this.rooms.report(room, user.sub, dto);
  }

  @Post(":id/block/:userId")
  async block(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Param("userId") targetId: string,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    return this.rooms.block(room, user.sub, targetId);
  }
}
