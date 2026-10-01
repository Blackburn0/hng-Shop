import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { requestIdFrom } from "@/lib/http/context";

/**
 * Next.js 16 proxy (formerly middleware), run before every page and API request:
 *  - assigns the request ID (kept from a valid incoming X-Request-Id, otherwise
 *    generated), forwards it to the handler and returns it on the response
 *  - refreshes the Supabase session so pages and API routes see a valid
 *    access token; refreshed cookies go to both the forwarded request and the response
 */
export async function proxy(request: NextRequest) {
  const requestId = requestIdFrom(request.headers);
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set("x-request-id", requestId);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("X-Request-Id", requestId);
    return res;
  };

  let response = forward();
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;

  const env = publicEnv();
  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = forward();
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Validates the token and refreshes it if expired. Don't add logic between
  // client creation and this call (Supabase SSR guidance).
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|products/|hero\\.jpg|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)"],
};
