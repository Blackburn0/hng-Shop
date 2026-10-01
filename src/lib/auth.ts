import type { User } from "@supabase/supabase-js";
import { createUserClient, type Db } from "@/lib/supabase/clients";
import { createRequestClient } from "@/lib/supabase/request";

export type AuthContext = { user: User; db: Db };

/**
 * Resolve the caller from `Authorization: Bearer <access token>` or, failing
 * that, the Supabase session cookies set by the browser. Returns null when
 * there is no valid session. The returned `db` acts as the user (RLS applies).
 * Session refresh happens earlier, in src/proxy.ts.
 */
export async function getAuth(req: Request): Promise<AuthContext | null> {
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const db = createUserClient(bearer);
    const { data, error } = await db.auth.getUser(bearer);
    return error || !data.user ? null : { user: data.user, db };
  }

  if (!req.headers.get("cookie")) return null;
  const { client: db } = createRequestClient(req);
  const { data, error } = await db.auth.getUser();
  return error || !data.user ? null : { user: data.user, db };
}
