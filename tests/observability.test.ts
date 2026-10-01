import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { GET as listProducts } from "@/app/api/v1/products/route";
import { requestIdFrom, traceIdFrom } from "@/lib/http/context";
import { route } from "@/lib/http/route";
import { log, redact } from "@/lib/log";
import { proxy } from "@/proxy";

// Cross-cutting behaviour of the route() wrapper, the logger and the proxy.
// Endpoint-specific status codes are covered in each endpoint's own test file.

type Line = Record<string, unknown> & { msg: string; level: string; requestId?: string };
let lines: Line[];

beforeEach(() => {
  lines = [];
  vi.stubEnv("LOG_LEVEL", "debug");
  const capture = (line: unknown) => void lines.push(JSON.parse(String(line)) as Line);
  for (const level of ["debug", "info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${path}`, { headers });

describe("X-Request-Id", () => {
  it("generates an ID when the caller sends none and returns it", async () => {
    const res = await health(get("/api/health"));

    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("keeps a valid incoming ID", async () => {
    const res = await health(get("/api/health", { "x-request-id": "client-abc.123:ok" }));

    expect(res.headers.get("x-request-id")).toBe("client-abc.123:ok");
  });

  it.each([
    ["with spaces", "abc def"],
    // (Newlines can't appear in HTTP header values at all; quotes and braces can.)
    ["with a log-injection attempt", 'x","level":"error","msg":"fake'],
    ["that is too long", "a".repeat(129)],
    ["that is empty", ""],
  ])("replaces an incoming ID %s", (_, value) => {
    expect(requestIdFrom(new Headers({ "x-request-id": value }))).toMatch(UUID);
  });
});

describe("traceparent", () => {
  it("extracts the trace ID from a valid W3C traceparent", () => {
    const h = new Headers({ traceparent: "00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01" });
    expect(traceIdFrom(h)).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
  });

  it.each(["garbage", "00-00000000000000000000000000000000-00f067aa0ba902b7-01", ""])("ignores %j", (value) => {
    expect(traceIdFrom(new Headers({ traceparent: value }))).toBeUndefined();
  });
});

describe("structured logs", () => {
  it("writes one JSON access line per request with the request and trace IDs", async () => {
    await health(
      get("/api/health", {
        "x-request-id": "req-1",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      }),
    );

    const access = lines.filter((l) => l.msg === "request");
    expect(access).toHaveLength(1);
    expect(access[0]).toEqual({
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.+Z$/),
      level: "info",
      msg: "request",
      requestId: "req-1",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      method: "GET",
      path: "/api/health",
      status: 200,
      durationMs: expect.any(Number),
    });
  });

  it("tags logs written deep inside a request with that request's ID", async () => {
    const handler = route({}, async () => {
      log.info("inside handler");
      return new Response(null, { status: 204 });
    });

    await handler(get("/x", { "x-request-id": "deep-1" }));

    expect(lines.find((l) => l.msg === "inside handler")?.requestId).toBe("deep-1");
  });

  it("never logs the query string (it can hold references or tokens)", async () => {
    await listProducts(get("/api/v1/products?limit=0&token=secret"));

    const access = lines.find((l) => l.msg === "request")!;
    expect(access.path).toBe("/api/v1/products");
    expect(JSON.stringify(lines)).not.toContain("secret");
  });

  it("respects LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "warn");
    log.info("hidden");
    log.warn("shown");

    expect(lines.map((l) => l.msg)).toEqual(["shown"]);
  });
});

describe("redaction", () => {
  it("removes personal data and secrets by key and by pattern", () => {
    const out = redact({
      email: "ada@example.com",
      customer: { phone: "08012345678", address: "12 Marina", name: "Ada" },
      authorization: "Bearer abc.def",
      note: "contact ada@example.com, key sk_test_123abc, header Bearer eyJhbGciOi.x.y",
      orderId: "e01ddc11-1111-4222-8333-444455556666",
      count: 3,
    });

    expect(out).toEqual({
      email: "<redacted>",
      customer: { phone: "<redacted>", address: "<redacted>", name: "<redacted>" },
      authorization: "<redacted>",
      note: "contact <email>, key <redacted-key>, header Bearer <redacted>",
      orderId: "e01ddc11-1111-4222-8333-444455556666",
      count: 3,
    });
  });

  it("flattens errors to name, message and code — no stack", () => {
    const err = Object.assign(new Error("failed for ada@example.com"), { code: "23505" });

    expect(redact({ err })).toEqual({ err: { name: "Error", message: "failed for <email>", code: "23505" } });
  });

  it("caps depth, array length and string length", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redact(deep))).toContain("[…]");
    expect((redact(Array.from({ length: 80 }, (_, i) => i)) as unknown[]).length).toBe(50);
    expect((redact("x".repeat(5000)) as string).length).toBe(2000);
  });
});

describe("route() error handling", () => {
  it("turns an unhandled error into a 500 problem without leaking details, and logs it", async () => {
    const handler = route({}, async () => {
      throw new Error("db password is hunter2 for ada@example.com");
    });

    const res = await handler(get("/boom", { "x-request-id": "boom-1" }));

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    expect(res.headers.get("x-request-id")).toBe("boom-1");
    const body = await res.text();
    expect(body).not.toContain("hunter2");
    const logged = lines.find((l) => l.msg === "unhandled error")!;
    expect(logged).toMatchObject({ level: "error", requestId: "boom-1", path: "/boom" });
    expect(JSON.stringify(logged)).toContain("<email>");
    expect(JSON.stringify(logged)).not.toContain("ada@example.com");
  });

  it("keeps the handler's own headers, including multiple Set-Cookie values", async () => {
    const handler = route({}, async () => {
      const headers = new Headers({ "Cache-Control": "no-store" });
      headers.append("Set-Cookie", "a=1; Path=/");
      headers.append("Set-Cookie", "b=2; Path=/");
      return new Response("ok", { status: 201, headers });
    });

    const res = await handler(get("/cookies"));

    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("can wrap redirects, whose headers are normally immutable", async () => {
    const handler = route({}, () => Response.redirect("http://localhost:3000/next", 303));

    const res = await handler(get("/go"));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("http://localhost:3000/next");
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });
});

describe("proxy", () => {
  it("assigns a request ID to page requests and forwards it to the handler", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/products"));

    const id = res.headers.get("x-request-id");
    expect(id).toMatch(UUID);
    // NextResponse.next({ request: { headers } }) forwards overridden headers like this:
    expect(res.headers.get("x-middleware-override-headers")).toContain("x-request-id");
    expect(res.headers.get("x-middleware-request-x-request-id")).toBe(id);
  });

  it("keeps a valid incoming request ID", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/", { headers: { "x-request-id": "edge-7" } }));

    expect(res.headers.get("x-request-id")).toBe("edge-7");
  });
});
