import { createServerClient } from "@supabase/ssr";
import type { TestUser } from "./db";

type Cookie = { name: string; value: string };

/**
 * The Supabase auth cookies a browser would hold for `user`, written by
 * @supabase/ssr itself. `mutate` can edit the stored session JSON (e.g. to
 * make the access token look expired) before the cookie is re-encoded.
 */
export async function sessionCookies(user: TestUser, mutate?: (session: Record<string, unknown>) => void) {
  const jar = new Map<string, string>();
  const ssr = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (c) => {
        for (const { name, value } of c) jar.set(name, value);
      },
    },
  });
  const { error } = await ssr.auth.setSession({ access_token: user.accessToken, refresh_token: user.refreshToken });
  if (error) throw error;

  let cookies: Cookie[] = [...jar].map(([name, value]) => ({ name, value })).filter((c) => c.value !== "");
  if (mutate) {
    // Recombine chunked cookies (name, name.0, name.1, ...) into one value.
    const base = cookies[0]!.name.replace(/\.\d+$/, "");
    const raw = cookies
      .filter((c) => c.name === base || c.name.startsWith(`${base}.`))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((c) => c.value)
      .join("");
    const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8"));
    mutate(session);
    cookies = [{ name: base, value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` }];
  }

  return { cookies, header: cookies.map((c) => `${c.name}=${c.value}`).join("; ") };
}
