import type { Session } from "@supabase/supabase-js";
import { makeRedirectUri } from "expo-auth-session";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Web only: finishes the sign-in popup when it lands on /auth/callback.
WebBrowser.maybeCompleteAuthSession();

type AuthApi = {
  session: Session | null;
  /** false until the stored session has been read on launch */
  ready: boolean;
  /** Google sign-in via Supabase (the same login as the website). Resolves to an error message, or null. */
  signIn(): Promise<string | null>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

// In Expo Go this is exp://<your-computer>:8081/--/auth/callback; in a real
// build it's coffeeshop://auth/callback. Supabase must allow it (Redirect URLs).
export const redirectUri = makeRedirectUri({ scheme: "coffeeshop", path: "auth/callback" });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectUri, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    if (error || !data.url) return "Google sign-in isn't available right now. Please try again.";

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri);
    if (result.type !== "success") return null; // closed or cancelled: not an error

    const { queryParams } = Linking.parse(result.url);
    const code = typeof queryParams?.code === "string" ? queryParams.code : null;
    if (!code) {
      return queryParams?.error ? "Google sign-in was cancelled." : "That sign-in didn't complete. Please try again.";
    }
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    return exchangeError ? "We couldn't finish signing you in. Please try again." : null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" });
  }, []);

  const value = useMemo(() => ({ session, ready, signIn, signOut }), [session, ready, signIn, signOut]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
