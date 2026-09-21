import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { createSnapshotSchema, type CreateSnapshotInput } from "@collabcanvas/shared";
import { CurrentUser } from "../common/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SnapshotsService } from "./snapshots.service";

@Controller("rooms/:id/snapshots")
export class SnapshotsController {
  constructor(@Inject(SnapshotsService) private readonly snapshots: SnapshotsService) {}

  @Get()
  list(@CurrentUser() user: { sub: string }, @Param("id") id: string) {
    return this.snapshots.list(id, user.sub);
  }

  @Post()
  create(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createSnapshotSchema)) dto: CreateSnapshotInput,
  ) {
    return this.snapshots.create(id, user.sub, dto);
  }

  @Get(":snapshotId")
  getData(@CurrentUser() user: { sub: string }, @Param("id") id: string, @Param("snapshotId") snapshotId: string) {
    return this.snapshots.getData(id, snapshotId, user.sub);
  }
}
