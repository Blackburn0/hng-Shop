import { type NextRequest, NextResponse } from "next/server";
import { createRequestClient, safeNext } from "@/lib/supabase/request";
import { route } from "@/lib/http/route";
import { LIMITS } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

/** Start Google sign-in. `?next=` is where to land afterwards (same-site paths only). */
export const GET = route({ rateLimit: { bucket: "auth", ...LIMITS.auth } }, async (req: NextRequest) => {
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"));
  const { client, applyCookies } = createRequestClient(req);

  const redirectTo = new URL("/auth/callback", url.origin);
  redirectTo.searchParams.set("next", next);

  const { data, error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectTo.toString(), skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
  });

  if (error || !data.url) {
    log.error("signInWithOAuth failed", { err: error ?? "no url returned" });
    const failure = new URL("/login", url.origin);
    failure.searchParams.set("error", "unavailable");
    failure.searchParams.set("next", next);
    return NextResponse.redirect(failure, 303);
  }

  // The PKCE code verifier cookie must travel with this redirect.
  return applyCookies(NextResponse.redirect(data.url, 303));
});
