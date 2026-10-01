import { requestContext } from "@/lib/http/context";

// Structured JSON logs, one object per line, tagged with the current request's
// ID. Personal data and secrets are removed before anything is written.

type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|email|phone|address|^name$/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const BEARER = /\b(Bearer|Basic)\s+[\w.~+/=-]+/gi;
const SECRET_KEY = /\b(sk|pk)_(test|live)_[\w]+/g;

function scrub(value: string): string {
  return value.replace(EMAIL, "<email>").replace(BEARER, "$1 <redacted>").replace(SECRET_KEY, "<redacted-key>");
}

/** Make a value safe to log: redact sensitive keys and patterns, flatten errors. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return scrub(value).slice(0, 2000);
  if (depth > 4) return "[…]";
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return { name: value.name, message: scrub(value.message).slice(0, 500), ...(code ? { code } : {}) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? "<redacted>" : redact(v, depth + 1);
    return out;
  }
  return String(value);
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  const threshold = ORDER[(process.env.LOG_LEVEL as Level | "silent" | undefined) ?? "info"] ?? ORDER.info;
  if (ORDER[level] < threshold) return;
  const ctx = requestContext.getStore();
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...(ctx ? { requestId: ctx.requestId, ...(ctx.traceId ? { traceId: ctx.traceId } : {}) } : {}),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
  });
  const sink = level === "debug" ? console.debug : level === "info" ? console.info : level === "warn" ? console.warn : console.error;
  sink(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write("error", msg, fields),
};
