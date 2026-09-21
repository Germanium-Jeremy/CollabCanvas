import { Injectable, Logger } from "@nestjs/common";
import { getEnv } from "../config/env";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window rate limiter. Uses Redis (INCR/EXPIRE) when REDIS_URL is set so
 * limits hold across API instances; falls back to an in-process map otherwise.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly buckets = new Map<string, Bucket>();
  private redis: import("ioredis").Redis | null = null;
  private redisFailed = false;

  private getRedis(): import("ioredis").Redis | null {
    const { REDIS_URL } = getEnv();
    if (!REDIS_URL || this.redisFailed) return null;
    if (!this.redis) {
      // Lazy require keeps ioredis out of the startup path when unused.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require("ioredis") as typeof import("ioredis").default;
      this.redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
      this.redis.on("error", (err) => {
        this.logger.warn(`Redis unavailable, falling back to in-memory limiter: ${err.message}`);
        this.redisFailed = true;
      });
    }
    return this.redis;
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const redis = this.getRedis();

    if (redis) {
      try {
        if (redis.status !== "ready") await redis.connect().catch(() => undefined);
        const windowSeconds = Math.ceil(windowMs / 1000);
        const bucketKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;
        const count = await redis.incr(bucketKey);
        if (count === 1) await redis.pexpire(bucketKey, windowMs);
        return {
          ok: count <= limit,
          remaining: Math.max(0, limit - count),
          retryAfterSeconds: count <= limit ? 0 : windowSeconds,
        };
      } catch {
        this.redisFailed = true;
      }
    }

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }
    existing.count += 1;
    const ok = existing.count <= limit;
    if (!ok && this.buckets.size > 10_000) this.sweep(now);
    return {
      ok,
      remaining: Math.max(0, limit - existing.count),
      retryAfterSeconds: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}
