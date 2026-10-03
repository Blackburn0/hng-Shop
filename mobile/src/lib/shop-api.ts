import { createApi } from "@/lib/api";
import { API_URL } from "@/lib/config";
import { supabase } from "@/lib/supabase";

/** The app-wide API client; it sends the signed-in user's Supabase token. */
export const api = createApi({
  baseUrl: API_URL,
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});
