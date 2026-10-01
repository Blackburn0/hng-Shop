import { existsSync } from "node:fs";

// Tests run against the hng-shop Supabase project (plan.md D6), using the same
// keys as the app. Helpers in tests/helpers/db.ts only touch rows they create.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Never send real mail through Gmail from tests. tests/email-fallback.test.ts
// sets fake credentials itself and replaces nodemailer with a stand-in.
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;

// Keep test output readable: only errors are logged unless a test turns
// logging up (tests/observability.test.ts does).
process.env.LOG_LEVEL ??= "error";

// The suite fires far more requests per minute than a real visitor would.
// tests/rate-limit.test.ts sets this back to 1 to check the real limits.
process.env.RATE_LIMIT_SCALE ??= "1000";
