import { existsSync } from "node:fs";

// Tests run against the hng-shop Supabase project (plan.md D6), using the same
// keys as the app. Helpers in tests/helpers/db.ts only touch rows they create.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
