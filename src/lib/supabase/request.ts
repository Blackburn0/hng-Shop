import { type CookieOptions, createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client bound to one request's cookies. Cookie writes (session,
 * PKCE verifier) are collected and copied onto whatever response the handler
 * finally returns via `applyCookies`. Uses the request itself rather than
 * next/headers, so handlers can be tested by calling them directly.
 */
export function createRequestClient(req: Request) {
  const env = publicEnv();
  const jar = new Map(
    parseCookieHeader(req.headers.get("cookie") ?? "").map(({ name, value }) => [name, value ?? ""]),
  );
  const pending: CookieToSet[] = [];

  const client = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const c of cookies) {
          jar.set(c.name, c.value);
          pending.push(c);
        }
      },
    },
  });

  function applyCookies<T extends NextResponse>(res: T): T {
    for (const { name, value, options } of pending) res.cookies.set(name, value, options);
    return res;
  }

  return { client, applyCookies };
}

/** Only same-site relative paths are allowed as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 512) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  try {
    // Reject anything that resolves off-site once parsed (e.g. "/\t/evil.com").
    const url = new URL(next, "http://localhost");
    return url.origin === "http://localhost" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
