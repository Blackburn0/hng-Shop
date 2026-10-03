// Build-time settings. EXPO_PUBLIC_* values are inlined into the app bundle, so
// only public values belong here (the Supabase anon key is meant to be public;
// the database rules decide what it can do). See mobile/.env.example.

const trimSlash = (url: string) => url.replace(/\/+$/, "");

/** The same server the website runs on; every request goes to its /api/v1. */
export const API_URL = trimSlash(process.env.EXPO_PUBLIC_API_URL ?? "https://hng-shop-oztn.vercel.app");

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Product and asset paths from the API are site-relative ("/products/x.jpg"). */
export function absoluteUrl(path: string): string {
  return /^https?:\/\//.test(path) ? path : `${API_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}
