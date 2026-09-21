import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import type { AiRequestInput, AiResult } from "@collabcanvas/shared";
import { AI_RATE_LIMIT_PER_HOUR } from "@collabcanvas/shared";
import { boardContextFromBase64, type BoardContext } from "@collabcanvas/yjs-utils";
import { getEnv } from "../config/env";
import { RateLimitService } from "../common/rate-limit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AI_PROVIDER } from "./ai.tokens";
import type { AiProvider } from "./ai.providers";

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimiter: RateLimitService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  async run(roomId: string, userId: string, dto: AiRequestInput): Promise<AiResult> {
    const env = getEnv();
    if (!env.AI_ENABLED) {
      throw new HttpException({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, error: "ai_disabled" }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    // Hard per-user cost control (AGENTS.md: 5 AI actions / hour).
    const limit = await this.rateLimiter.check(`ai:${userId}`, AI_RATE_LIMIT_PER_HOUR, 60 * 60 * 1000);
    if (!limit.ok) {
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: "ai_rate_limited", retryAfterSeconds: limit.retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const context = await this.resolveBoardContext(roomId, dto.boardBase64);

    try {
      switch (dto.action) {
        case "summarize":
          return await this.provider.summarize(context);
        case "suggest":
          return await this.provider.suggest(context);
        case "diagram":
          return await this.provider.diagram(dto.prompt ?? "", context);
      }
    } catch (error) {
      // Graceful degradation: AI provider failures must never take the board down.
      this.logger.warn(`AI provider "${this.provider.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new HttpException({ statusCode: HttpStatus.SERVICE_UNAVAILABLE, error: "ai_unavailable" }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /** Prefer the client-provided board state (fresh); fall back to the last persisted snapshot. */
  private async resolveBoardContext(roomId: string, boardBase64?: string): Promise<BoardContext> {
    const base64 = boardBase64 ?? (await this.prisma.room.findUnique({ where: { id: roomId } }))?.boardData ?? null;
    if (!base64) {
      return { elementCount: 0, countsByType: {}, texts: [] };
    }
    return boardContextFromBase64(base64);
  }
}
