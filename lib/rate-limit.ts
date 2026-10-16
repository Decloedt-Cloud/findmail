const memoryBuckets = new Map<string, number[]>();

export type RateLimitResult = { ok: boolean; remaining: number; retryAfterMs: number };

export function takeMemoryToken(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  const recent = (memoryBuckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    memoryBuckets.set(key, recent);
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }
  recent.push(now);
  memoryBuckets.set(key, recent);
  return { ok: true, remaining: limit - recent.length, retryAfterMs: 0 };
}

export function resetMemoryRateLimits() {
  memoryBuckets.clear();
}

type RedisCommander = {
  zremrangebyscore: (key: string, min: number, max: number) => RedisCommander;
  zcard: (key: string) => RedisCommander;
  zadd: (key: string, score: number, member: string) => RedisCommander;
  pexpire: (key: string, ms: number) => RedisCommander;
  exec: () => Promise<Array<[Error | null, unknown]> | null>;
};

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  redis?: object | null,
): Promise<RateLimitResult> {
  if (!redis || !("multi" in redis) || typeof redis.multi !== "function") return takeMemoryToken(key, limit, windowMs);
  const now = Date.now();
  const member = `${now}-${Math.random().toString(36).slice(2)}`;
  try {
    const result = await (redis.multi() as RedisCommander)
      .zremrangebyscore(key, 0, now - windowMs)
      .zcard(key)
      .zadd(key, now, member)
      .pexpire(key, windowMs)
      .exec();
    const count = Number(result?.[1]?.[1] ?? 0);
    if (count >= limit) {
      return { ok: false, remaining: 0, retryAfterMs: windowMs };
    }
    return { ok: true, remaining: Math.max(0, limit - count - 1), retryAfterMs: 0 };
  } catch {
    return takeMemoryToken(key, limit, windowMs);
  }
}
