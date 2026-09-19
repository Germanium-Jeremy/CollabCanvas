import type { PrismaClient } from "@prisma/client";
import { effectiveRole, type JwtPayload, type RoomRole } from "@collabcanvas/shared";
import jwt from "jsonwebtoken";

type PrismaLike = Pick<PrismaClient, "room" | "block">;

interface CacheEntry {
  role: RoomRole | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;

/**
 * Resolves who may connect to a room and what they may do there.
 * Role lookups are cached briefly; blocks and role changes take effect within the TTL.
 */
export class AccessService {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly jwtSecret: string,
    private readonly prisma: PrismaLike,
  ) {}

  verifyToken(token: string): JwtPayload | null {
    try {
      const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;
      return payload.sub && payload.email ? payload : null;
    } catch {
      return null;
    }
  }

  async resolveRole(roomId: string, userId: string): Promise<RoomRole | null> {
    const key = `${roomId}:${userId}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.role;

    let role: RoomRole | null = null;
    try {
      const [room, block] = await Promise.all([
        this.prisma.room.findUnique({ where: { id: roomId }, include: { members: true } }),
        this.prisma.block.findUnique({
          where: { roomId_blockedUserId: { roomId, blockedUserId: userId } },
          select: { id: true },
        }),
      ]);
      if (room && !room.deletedAt && !block) {
        role = effectiveRole(
          {
            isPublic: room.isPublic,
            deletedAt: room.deletedAt,
            ownerId: room.ownerId,
            members: room.members.map((m) => ({ userId: m.userId, role: m.role as RoomRole })),
          },
          userId,
        );
      }
    } catch {
      // DB hiccup: deny by default (fail closed).
      role = null;
    }

    this.cache.set(key, { role, expiresAt: Date.now() + CACHE_TTL_MS });
    if (this.cache.size > 10_000) {
      for (const [k, entry] of this.cache) if (entry.expiresAt <= Date.now()) this.cache.delete(k);
    }
    return role;
  }
}
