// On Android/iOS, give the app a persistent `localStorage` (backed by SQLite)
// so the Supabase session survives restarts. Expo SDK 57 guidance.
import "expo-sqlite/localStorage/install";

export const sessionStorage = globalThis.localStorage;
