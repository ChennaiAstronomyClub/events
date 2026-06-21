import { Redis } from "@upstash/redis";

let _client: Redis | null = null;

export function getRedisClient(): Redis | null {
  if (_client) return _client;

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) return null;

  try {
    _client = new Redis({ url, token });
    return _client;
  } catch {
    return null;
  }
}

export async function redisGet<T>(key: string): Promise<T | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    return await redis.get<T>(key);
  } catch (err) {
    console.warn("[redis] GET failed:", key, err);
    return null;
  }
}

export async function redisSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.warn("[redis] SET failed:", key, err);
  }
}

export async function redisDel(key: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch (err) {
    console.warn("[redis] DEL failed:", key, err);
  }
}

/** Returns true if the key was set (lock acquired), false if already held. */
export async function redisSetNx(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true; // no Redis → proceed without lock
  try {
    const result = await redis.set(key, value, { nx: true, ex: ttlSeconds });
    return result === "OK";
  } catch (err) {
    console.warn("[redis] SETNX failed:", key, err);
    return true; // on error → proceed without lock
  }
}
