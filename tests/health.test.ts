import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

// /health is liveness only: no input, auth, or persistence — only the success
// category applies.
describe("GET /api/health", () => {
  it("returns 200 with status ok and a no-store cache header", async () => {
    const res = GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(new Date(body.time).toISOString()).toBe(body.time);
  });
});
