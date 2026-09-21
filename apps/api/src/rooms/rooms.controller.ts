import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import {
  createRoomSchema,
  joinRoomSchema,
  reportSchema,
  setMemberRoleSchema,
  updateRoomSchema,
  type CreateRoomInput,
  type JoinRoomInput,
  type ReportInput,
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
      inviteCode: room.isPublic ? null : room.inviteCode,
      role,
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
