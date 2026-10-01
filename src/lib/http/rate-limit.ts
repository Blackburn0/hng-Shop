// Fixed-window rate limiter kept in memory (plan.md Phase 8). Each server
// instance counts on its own, so on Vercel the effective limit is approximate;
// a Vercel Firewall rule can add a hard, global limit (plan.md Phase 9).

export type Limit = { limit: number; windowMs: number };
export type Decision = { ok: boolean; limit: number; remaining: number; resetAt: number };

const buckets = new Map<string, { count: number; resetAt: number }>();
const MAX_BUCKETS = 50_000;

export const LIMITS = {
  /** browsing: product list/detail */
  read: { limit: 120, windowMs: 60_000 },
  /** cart, order history, payment status polling */
  user: { limit: 60, windowMs: 60_000 },
  /** placing orders */
  checkout: { limit: 10, windowMs: 60_000 },
  /** sign-in flow */
  auth: { limit: 20, windowMs: 60_000 },
} satisfies Record<string, Limit>;

/** RATE_LIMIT_SCALE multiplies every limit (the test suite raises it; 1 by default). */
function scaled(limit: number): number {
  const scale = Number(process.env.RATE_LIMIT_SCALE ?? 1);
  return Math.max(1, Math.floor(limit * (Number.isFinite(scale) && scale > 0 ? scale : 1)));
}

export function hit(key: string, { limit: base, windowMs }: Limit, now = Date.now()): Decision {
  const limit = scaled(base);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) prune(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return { ok: bucket.count <= limit, limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

function prune(now: number) {
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key);
  // Still full (a flood of distinct keys)? Drop the oldest half.
  if (buckets.size >= MAX_BUCKETS) [...buckets.keys()].slice(0, MAX_BUCKETS / 2).forEach((k) => buckets.delete(k));
}

/** Test helper: forget all counts. */
export function resetRateLimits() {
  buckets.clear();
}

/**
 * Client IP as seen by the platform. Vercel overwrites x-forwarded-for with
 * the real client address, so the first hop is trustworthy there.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}
