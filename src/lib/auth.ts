import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";
import { createUserClient, type Db } from "@/lib/supabase/clients";

export type AuthContext = { user: User; db: Db };

/**
 * Resolve the caller from `Authorization: Bearer <access token>` or, failing
 * that, the Supabase session cookies set by the browser. Returns null when
 * there is no valid session. The returned `db` acts as the user (RLS applies).
 *
 * Reads cookies from the request itself (not next/headers) so route handlers
 * can be exercised directly in tests. Session refresh happens in src/proxy.ts.
 */
export async function getAuth(req: Request): Promise<AuthContext | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const db = createUserClient(bearer);
    const { data, error } = await db.auth.getUser(bearer);
    return error || !data.user ? null : { user: data.user, db };
  }

  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const env = publicEnv();
  const db = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => parseCookieHeader(cookieHeader).map(({ name, value }) => ({ name, value: value ?? "" })),
      setAll: () => {},
    },
  });
  const { data, error } = await db.auth.getUser();
  return error || !data.user ? null : { user: data.user, db };
}
