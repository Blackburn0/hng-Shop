import { type NextRequest, NextResponse } from "next/server";
import { problem } from "@/lib/http/problem";
import { createRequestClient } from "@/lib/supabase/request";

export const dynamic = "force-dynamic";

/** Sign out (form POST from the header). Clears the session cookies. */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);

  // Cross-site form posts can't sign people out.
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) {
    return problem({ status: 403, type: "forbidden", title: "Cross-site request refused", instance: url.pathname });
  }

  const { client, applyCookies } = createRequestClient(req);
  await client.auth.signOut({ scope: "local" });
  return applyCookies(NextResponse.redirect(new URL("/", url.origin), 303));
}
