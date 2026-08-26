import "server-only";

/**
 * Sliding-window rate limiter, distributed via Upstash Redis when configured.
 *
 * Falls back to a process-local in-memory window when `UPSTASH_REDIS_REST_URL`
 * / `UPSTASH_REDIS_REST_TOKEN` are unset (local dev, tests). In that fallback
 * mode limits apply per serverless instance / Node process, not globally —
 * attackers can obtain `limit × instance_count` requests per window.
 *
 * Fail-safe: when the limit is exceeded the request is rejected with 429.
 */
import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

const limiters = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  const existing = limiters.get(cacheKey);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis: redis!,
    limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
    analytics: false,
    prefix: "sequrai-ratelimit",
  });
  limiters.set(cacheKey, limiter);
  return limiter;
}

export type RateLimitOptions = {
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  /** Typed error code + message for callers that need a structured body (e.g. MCP). */
  errorCode?: string;
  errorMessage?: string;
};

function clientKey(request: Request, keyPrefix: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    forwarded?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";
  return `${keyPrefix}:${ip}`;
}

function rateLimitedResponse(options: RateLimitOptions): NextResponse {
  return NextResponse.json(
    {
      error: options.errorMessage ?? "Too many requests",
      ...(options.errorCode ? { code: options.errorCode } : {}),
    },
    { status: 429 }
  );
}

function enforceInMemory(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

export async function enforceRateLimit(
  request: Request,
  options: RateLimitOptions = {},
): Promise<NextResponse | null> {
  const limit = options.limit ?? 120;
  const windowMs = options.windowMs ?? 60_000;
  const key = clientKey(request, options.keyPrefix ?? "api");

  if (redis) {
    const { success } = await getLimiter(limit, windowMs).limit(key);
    return success ? null : rateLimitedResponse(options);
  }

  const allowed = enforceInMemory(key, limit, windowMs);
  return allowed ? null : rateLimitedResponse(options);
}

export function resetRateLimitStateForTests() {
  buckets.clear();
}
