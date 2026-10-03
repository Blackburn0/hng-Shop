"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Browser-side Supabase client, used only for Realtime (the live cart signal).
 * It reads the same session cookies the server set at sign-in; all data still
 * goes through /api/v1.
 */
export function browserSupabase() {
  const env = publicEnv();
  client ??= createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return client;
}
