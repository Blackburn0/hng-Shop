import { createClient } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { sessionStorage } from "@/lib/storage";

// Supabase is used for two things only: Google sign-in (to get an access token
// for the API) and Realtime (the live cart signal). Shop data goes through the
// website's /api/v1.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: "pkce", // OAuth returns ?code=, exchanged in AuthProvider
  },
});

// Refresh tokens only while the app is in the foreground (Supabase + Expo guidance).
if (Platform.OS !== "web") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

// Development on web only: lets a test session be injected from the browser
// console (used to test the app without a real Google sign-in). Never in builds.
if (__DEV__ && Platform.OS === "web") {
  (globalThis as { __coffeeShopSupabase?: typeof supabase }).__coffeeShopSupabase = supabase;
}
