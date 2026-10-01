import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/** For Server Components. Session refresh is handled by src/proxy.ts. */
export async function createServerComponentClient() {
  const env = publicEnv();
  const store = await cookies();
  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) store.set(name, value, options);
        } catch {
          // Server Components can't write cookies; the proxy already refreshed them.
        }
      },
    },
  });
}

/** The signed-in user for this render, or null. Deduplicated per request. */
export const getCurrentUser = cache(async () => {
  const db = await createServerComponentClient();
  const { data } = await db.auth.getUser();
  return data.user;
});
