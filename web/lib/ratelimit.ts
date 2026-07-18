import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Rate-limit distribué via Upstash Redis.
// GRACIEUX : si UPSTASH_REDIS_REST_URL / _TOKEN sont absents, `allow()` renvoie
// toujours true (aucune limite) — l'app tourne normalement sans Upstash configuré.
const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

type Window = `${number} ${"s" | "m" | "h" | "d"}`;
function make(limit: number, window: Window, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix,
    analytics: false,
  });
}

// Paliers : general = garde-fou global, enrich = actions qui tapent les APIs,
// heavy = actions très coûteuses (rescan de toute la liste).
const limiters = {
  general: make(40, "1 m", "rl:gen"),
  enrich: make(15, "1 m", "rl:enrich"),
  heavy: make(4, "10 m", "rl:heavy"),
};

export type RateTier = keyof typeof limiters;

/** true = autorisé. No-op (toujours true) si Upstash n'est pas configuré. */
export async function allow(tier: RateTier, key: string): Promise<boolean> {
  const l = limiters[tier];
  if (!l) return true;
  try {
    const { success } = await l.limit(key);
    return success;
  } catch {
    return true; // si Redis est indisponible, on ne bloque pas l'utilisateur
  }
}

/** Clé d'identification : IP (proxy Vercel) pour le rate-limit anonyme. */
export function ipFrom(h: Headers): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
