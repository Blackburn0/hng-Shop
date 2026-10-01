import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/ready/route";

// Readiness takes no input or auth — only the "dependency up" and
// "dependency down" cases apply.
describe("GET /api/ready", () => {
  const realUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = realUrl;
  });

  it("returns 200 when the database is reachable", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ready", checks: { database: "ok" } });
  });

  it("returns 503 without leaking details when the database is unreachable", async () => {
    // Port 9 (discard) on loopback: connection refused, fast.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:9";

    const res = await GET();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable", checks: { database: "error" } });
  });
});
