import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PUT as setItem } from "@/app/api/v1/cart/items/[productId]/route";
import { POST as createOrder } from "@/app/api/v1/orders/route";
import { GET as listProducts } from "@/app/api/v1/products/route";
import { POST as webhook } from "@/app/api/v1/payments/paystack/webhook/route";
import { readJson } from "@/lib/http/problem";
import { clientIp, hit, LIMITS, resetRateLimits } from "@/lib/http/rate-limit";
import { route } from "@/lib/http/route";
import { expectProblem, params } from "./helpers/http";

// Rate limits and body-size limits. The rest of the suite runs with
// RATE_LIMIT_SCALE=1000 (tests/setup.ts); here the real limits apply.

const at = (path: string, ip: string, init: RequestInit = {}) =>
  new Request(`http://localhost:3000${path}`, {
    ...init,
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1`, ...(init.headers as Record<string, string>) },
  });

beforeEach(() => {
  vi.stubEnv("RATE_LIMIT_SCALE", "1");
  resetRateLimits();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("hit()", () => {
  it("allows up to the limit in a window, then refuses until the window resets", () => {
    const limit = { limit: 3, windowMs: 1000 };
    const t0 = 1_000_000;

    expect([1, 2, 3].map(() => hit("k", limit, t0).ok)).toEqual([true, true, true]);
    expect(hit("k", limit, t0 + 999)).toMatchObject({ ok: false, remaining: 0, resetAt: t0 + 1000 });
    expect(hit("k", limit, t0 + 1000)).toMatchObject({ ok: true, remaining: 2 });
  });

  it("counts keys separately", () => {
    const limit = { limit: 1, windowMs: 1000 };
    expect(hit("a", limit).ok).toBe(true);
    expect(hit("b", limit).ok).toBe(true);
    expect(hit("a", limit).ok).toBe(false);
  });

  it("caps memory: expired buckets are dropped first, then the oldest half under a flood", () => {
    const limit = { limit: 1, windowMs: 1000 };
    const t0 = 5_000_000;
    // 50,000 buckets that all expire at t0 + 1000.
    for (let i = 0; i < 50_000; i++) hit(`old-${i}`, limit, t0);

    // Once they've expired, a new key prunes them, so an old key starts fresh.
    hit("fresh", limit, t0 + 1000);
    expect(hit("old-0", limit, t0 + 1000).ok).toBe(true);

    // A flood of distinct live keys: when full, the oldest half is evicted.
    resetRateLimits();
    for (let i = 0; i < 50_000; i++) hit(`live-${i}`, limit, t0);
    expect(hit("live-49999", limit, t0).ok).toBe(false); // still tracked (over its limit)
    hit("trigger", limit, t0 + 1); // full and nothing expired -> evict oldest half
    expect(hit("live-0", limit, t0 + 1).ok).toBe(true); // evicted, so counted from zero
    expect(hit("live-49999", limit, t0 + 1).ok).toBe(false); // newest half kept
  });

  it.each([
    ["2", 6],
    ["0.5", 1],
    ["nonsense", 3],
    ["-4", 3],
  ])("applies RATE_LIMIT_SCALE=%s", (scale, expected) => {
    vi.stubEnv("RATE_LIMIT_SCALE", scale);
    expect(hit(`scale-${scale}`, { limit: 3, windowMs: 1000 }).limit).toBe(expected);
  });
});

describe("clientIp()", () => {
  it.each([
    [{ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }, "203.0.113.7"],
    [{ "x-real-ip": "198.51.100.2" }, "198.51.100.2"],
    [{}, "unknown"],
  ])("%j -> %s", (headers, expected) => {
    expect(clientIp(new Headers(headers))).toBe(expected);
  });
});

describe("rate limiting on endpoints", () => {
  it("GET /api/v1/products returns 429 with Retry-After after 120 requests a minute from one IP", async () => {
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < LIMITS.read.limit + 1; i++) {
      last = await listProducts(at("/api/v1/products?limit=0", "203.0.113.10")); // 400 is fine: still counted
      statuses.push(last.status);
    }

    expect(statuses.slice(0, LIMITS.read.limit).every((s) => s === 400)).toBe(true);
    const body = await expectProblem(last!, 429, "/api/v1/products");
    expect(body.detail).toMatch(/wait \d+ seconds/);
    expect(Number(last!.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(Number(last!.headers.get("retry-after"))).toBeLessThanOrEqual(60);
    expect(last!.headers.get("ratelimit-limit")).toBe("120");
    expect(last!.headers.get("ratelimit-remaining")).toBe("0");
    expect(last!.headers.get("x-request-id")).toBeTruthy();
  });

  it("doesn't let one IP's traffic block another", async () => {
    for (let i = 0; i < LIMITS.read.limit + 1; i++) await listProducts(at("/api/v1/products?limit=0", "203.0.113.11"));

    const other = await listProducts(at("/api/v1/products?limit=0", "203.0.113.12"));
    expect(other.status).toBe(400);
    expect(other.headers.get("ratelimit-remaining")).toBe(String(LIMITS.read.limit - 1));
  });

  it("lets a limited client back in once the window passes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < LIMITS.checkout.limit + 1; i++) await createOrder(at("/api/v1/orders", "203.0.113.13", { method: "POST" }));
    expect((await createOrder(at("/api/v1/orders", "203.0.113.13", { method: "POST" }))).status).toBe(429);

    vi.setSystemTime(Date.now() + LIMITS.checkout.windowMs);

    expect((await createOrder(at("/api/v1/orders", "203.0.113.13", { method: "POST" }))).status).toBe(401);
  });

  it("POST /api/v1/orders allows 10 a minute per IP (checks the limit before auth)", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await createOrder(at("/api/v1/orders", "203.0.113.14", { method: "POST" }))).status);

    expect(statuses).toEqual([...Array(10).fill(401), 429]);
  });

  it("doesn't rate-limit the Paystack webhook (it's signature-checked instead)", async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < 150; i++) {
      statuses.add((await webhook(at("/api/v1/payments/paystack/webhook", "203.0.113.15", { method: "POST", body: "{}" }))).status);
    }
    expect([...statuses]).toEqual([401]);
  });
});

describe("request body size limits", () => {
  const big = JSON.stringify({ quantity: 1, pad: "x".repeat(20 * 1024) });
  const productId = "00000000-0000-4000-8000-000000000000";

  it("returns 413 when Content-Length is over 16 KB, before the handler runs", async () => {
    const res = await setItem(
      at(`/api/v1/cart/items/${productId}`, "203.0.113.20", {
        method: "PUT",
        headers: { "content-length": String(Buffer.byteLength(big)), "content-type": "application/json" },
        body: big,
      }),
      params({ productId }),
    );

    const problem = await expectProblem(res, 413, `/api/v1/cart/items/${productId}`);
    expect(problem.detail).toContain("16 KB");
  });

  it("readJson() also enforces the limit when no Content-Length is sent", async () => {
    const result = await readJson(new Request("http://localhost:3000/x", { method: "POST", body: big }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.status).toBe(413);
  });

  it("readJson() returns 400 for malformed JSON and the value for valid JSON", async () => {
    const bad = await readJson(new Request("http://localhost:3000/x", { method: "POST", body: "{" }));
    const good = await readJson(new Request("http://localhost:3000/x", { method: "POST", body: '{"a":1}' }));

    expect(bad.ok ? 0 : bad.error.status).toBe(400);
    expect(good).toEqual({ ok: true, value: { a: 1 } });
  });

  it("allows a larger limit where configured (webhook: 64 KB)", async () => {
    const handler = route({ maxBodyBytes: 64 * 1024 }, () => new Response(null, { status: 204 }));
    const res = await handler(
      at("/hook", "203.0.113.21", { method: "POST", headers: { "content-length": String(30 * 1024) }, body: "x".repeat(30 * 1024) }),
    );
    expect(res.status).toBe(204);
  });

  it("doesn't apply a body limit to GET requests", async () => {
    const handler = route({}, () => new Response(null, { status: 204 }));
    expect((await handler(at("/read", "203.0.113.22", { headers: { "content-length": "999999" } }))).status).toBe(204);
  });
});
