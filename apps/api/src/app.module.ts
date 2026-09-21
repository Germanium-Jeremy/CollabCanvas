import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "./common/jwt-auth.guard";
import { RateLimitModule } from "./common/rate-limit.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { RoomsModule } from "./rooms/rooms.module";
import { AiModule } from "./ai/ai.module";
import { SnapshotsModule } from "./snapshots/snapshots.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [RateLimitModule, PrismaModule, AuthModule, RoomsModule, AiModule, SnapshotsModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
