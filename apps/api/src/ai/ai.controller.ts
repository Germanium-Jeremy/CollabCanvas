import { Body, Controller, HttpCode, Inject, Param, Post } from "@nestjs/common";
import { aiRequestSchema, type AiRequestInput } from "@collabcanvas/shared";
import { CurrentUser } from "../common/auth.decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AiService } from "./ai.service";
import { RoomsService } from "../rooms/rooms.service";

@Controller("rooms")
export class AiController {
  constructor(
    @Inject(AiService) private readonly ai: AiService,
    @Inject(RoomsService) private readonly rooms: RoomsService,
  ) {}

  /** AI actions require edit rights: cost control and viewer write-safety. */
  @Post(":id/ai")
  @HttpCode(200)
  async run(
    @CurrentUser() user: { sub: string },
    @Param("id") id: string,
    @Body(new ZodValidationPipe(aiRequestSchema)) dto: AiRequestInput,
  ) {
    const room = await this.rooms.getRoomOrThrow(id);
    this.rooms.assertAccess(room, user.sub, "edit");
    return this.ai.run(id, user.sub, dto);
  }
}
