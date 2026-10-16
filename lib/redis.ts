import IORedis from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: IORedis | null; redisUrl?: string };

export function getRedis() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;
  if (globalForRedis.redis && globalForRedis.redisUrl === url) return globalForRedis.redis;
  const redis = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  globalForRedis.redis = redis;
  globalForRedis.redisUrl = url;
  return redis;
}

export async function redisStatus() {
  const redis = getRedis();
  if (!redis) return "not_configured" as const;
  try {
    if (redis.status === "wait") await redis.connect();
    const pong = await redis.ping();
    return pong === "PONG" ? ("ok" as const) : ("down" as const);
  } catch {
    return "down" as const;
  }
}
