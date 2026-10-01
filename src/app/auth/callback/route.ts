import { type NextRequest, NextResponse } from "next/server";
import { createRequestClient, safeNext } from "@/lib/supabase/request";

export const dynamic = "force-dynamic";

/** Google -> Supabase -> here with `?code=`. Exchange it for a session cookie. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));

  const fail = (reason: string) => {
    const to = new URL("/login", url.origin);
    to.searchParams.set("error", reason);
    to.searchParams.set("next", next);
    return NextResponse.redirect(to, 303);
  };

  // e.g. the user pressed "Cancel" on Google's consent screen.
  if (url.searchParams.get("error")) return fail("access_denied");

  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");

  const { client, applyCookies } = createRequestClient(req);
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error) {
    console.warn("OAuth code exchange failed", error.code ?? error.name);
    return applyCookies(fail("exchange_failed"));
  }

  return applyCookies(NextResponse.redirect(new URL(next, url.origin), 303));
}
