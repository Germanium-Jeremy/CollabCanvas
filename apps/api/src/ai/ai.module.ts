import { Module } from "@nestjs/common";
import { AI_PROVIDER } from "./ai.tokens";
import { createAiProvider } from "./ai.providers";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { RoomsModule } from "../rooms/rooms.module";

@Module({
  imports: [RoomsModule],
  controllers: [AiController],
  providers: [
    { provide: AI_PROVIDER, useFactory: createAiProvider },
    AiService,
  ],
})
export class AiModule {}
