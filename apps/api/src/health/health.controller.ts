import { Controller, Get, Inject } from "@nestjs/common";
import { Public } from "../common/auth.decorators";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let db = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = "up";
    } catch {
      db = "down";
    }
    return {
      status: db === "up" ? "ok" : "degraded",
      db,
      timestamp: new Date().toISOString(),
    };
  }
}
