import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getCart } from "@/app/api/v1/cart/route";
import { GET as callback } from "@/app/auth/callback/route";
import { GET as login } from "@/app/auth/login/route";
import { POST as signout } from "@/app/auth/signout/route";
import { safeNext } from "@/lib/supabase/request";
import { proxy } from "@/proxy";
import { cleanup, createTestUser, type TestUser } from "./helpers/db";
import { expectProblem } from "./helpers/http";
import { sessionCookies } from "./helpers/session";

// Google itself can't be driven from a test, so the successful code exchange
// is verified manually in the browser. Everything around it is covered here:
// the redirect to Google, every failure path back from it, sign-out and the
// session refresh in the proxy.

const ORIGIN = "http://localhost:3000";
const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`${ORIGIN}${path}`, init);
const location = (res: Response) => new URL(res.headers.get("location")!);
const setCookies = (res: Response) => res.headers.getSetCookie();

let user: TestUser;
beforeAll(async () => {
  user = await createTestUser();
});
afterAll(cleanup);

describe("safeNext", () => {
  it.each([
    ["/checkout", "/checkout"],
    ["/products?category=coffee", "/products?category=coffee"],
    ["/orders/abc#top", "/orders/abc#top"],
    [null, "/"],
    ["", "/"],
    ["checkout", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"],
    [`/${"a".repeat(600)}`, "/"],
  ])("%s -> %s", (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});

describe("GET /auth/login", () => {
  it("redirects to Supabase's Google authorize URL with PKCE and the callback", async () => {
    const res = await login(req("/auth/login?next=/checkout"));

    expect(res.status).toBe(303);
    const to = location(res);
    expect(`${to.origin}${to.pathname}`).toBe(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/authorize`);
    expect(to.searchParams.get("provider")).toBe("google");
    expect(to.searchParams.get("code_challenge")).toBeTruthy();
    expect(to.searchParams.get("prompt")).toBe("select_account");
    expect(to.searchParams.get("redirect_to")).toBe(`${ORIGIN}/auth/callback?next=%2Fcheckout`);
    expect(setCookies(res).some((c) => /-auth-token-code-verifier=/.test(c))).toBe(true);
  });

  it("drops an off-site next parameter", async () => {
    const res = await login(req("/auth/login?next=//evil.example"));

    expect(location(res).searchParams.get("redirect_to")).toBe(`${ORIGIN}/auth/callback?next=%2F`);
  });
});

describe("GET /auth/callback", () => {
  it("sends the user back to /login when they cancel on Google", async () => {
    const res = await callback(req("/auth/callback?error=access_denied&next=/checkout"));

    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe("/login");
    expect(location(res).searchParams.get("error")).toBe("access_denied");
    expect(location(res).searchParams.get("next")).toBe("/checkout");
  });

  it("reports a missing code", async () => {
    const res = await callback(req("/auth/callback"));

    expect(location(res).searchParams.get("error")).toBe("missing_code");
    expect(location(res).searchParams.get("next")).toBe("/");
  });

  it("reports a failed exchange when the PKCE verifier cookie is missing", async () => {
    const res = await callback(req("/auth/callback?code=abc&next=/checkout"));

    expect(location(res).searchParams.get("error")).toBe("exchange_failed");
    expect(setCookies(res).some((c) => /-auth-token=base64-/.test(c))).toBe(false);
  });

  it("reports a failed exchange when Supabase rejects the code", async () => {
    // Get a real verifier cookie from /auth/login, then present a bogus code.
    const start = await login(req("/auth/login"));
    const verifier = setCookies(start)
      .map((c) => c.split(";")[0]!)
      .find((c) => c.includes("code-verifier"))!;

    const res = await callback(req("/auth/callback?code=00000000-0000-0000-0000-000000000000", { headers: { cookie: verifier } }));

    expect(location(res).pathname).toBe("/login");
    expect(location(res).searchParams.get("error")).toBe("exchange_failed");
  });

  it("never redirects off-site after a failure", async () => {
    const res = await callback(req("/auth/callback?next=https://evil.example"));

    expect(location(res).origin).toBe(ORIGIN);
    expect(location(res).searchParams.get("next")).toBe("/");
  });
});

describe("POST /auth/signout", () => {
  it("clears the session cookies, revokes the session and redirects home", async () => {
    const leaving = await createTestUser(); // this session gets revoked
    const { header } = await sessionCookies(leaving);

    const res = await signout(req("/auth/signout", { method: "POST", headers: { cookie: header, origin: ORIGIN } }));

    expect(res.status).toBe(303);
    expect(location(res).toString()).toBe(`${ORIGIN}/`);
    const cleared = setCookies(res).filter((c) => /-auth-token(\.\d+)?=/.test(c));
    expect(cleared.length).toBeGreaterThan(0);
    expect(cleared.every((c) => /Max-Age=0/i.test(c))).toBe(true);

    // The old access token no longer works against the API.
    const after = await getCart(new Request(`${ORIGIN}/api/v1/cart`, { headers: { cookie: header } }));
    expect(after.status).toBe(401);
  });

  it("redirects home even with no session", async () => {
    const res = await signout(req("/auth/signout", { method: "POST" }));
    expect(res.status).toBe(303);
  });

  it("refuses a cross-site sign-out with 403", async () => {
    const res = await signout(req("/auth/signout", { method: "POST", headers: { origin: "https://evil.example" } }));
    await expectProblem(res, 403, "/auth/signout");
  });
});

describe("proxy (session refresh)", () => {
  it("passes anonymous requests straight through", async () => {
    const res = await proxy(req("/products"));

    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(setCookies(res)).toEqual([]);
  });

  it("leaves a valid session untouched", async () => {
    const { header } = await sessionCookies(user);
    const res = await proxy(req("/products", { headers: { cookie: header } }));

    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(setCookies(res).filter((c) => /-auth-token/.test(c))).toEqual([]);
  });

  it("refreshes an expired access token and forwards the new cookie", async () => {
    const fresh = await createTestUser(); // its own refresh token, used once here
    const { header } = await sessionCookies(fresh, (s) => {
      s.expires_at = Math.floor(Date.now() / 1000) - 60;
    });

    const res = await proxy(req("/checkout", { headers: { cookie: header } }));

    expect(res.headers.get("x-middleware-next")).toBe("1");
    const refreshed = setCookies(res).filter((c) => /-auth-token(\.\d+)?=base64-/.test(c));
    expect(refreshed.length).toBeGreaterThan(0);
    expect(res.headers.get("x-middleware-request-cookie") ?? "").toMatch(/-auth-token/);
  });
});
