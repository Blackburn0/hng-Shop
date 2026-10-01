import { z } from "zod";

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const limitParam = z.coerce
  .number({ error: "must be a number" })
  .int("must be a whole number")
  .min(1, "must be at least 1")
  .max(MAX_LIMIT, `must be at most ${MAX_LIMIT}`)
  .default(DEFAULT_LIMIT);

export type Page<T> = { data: T[]; nextCursor: string | null };

/** Opaque cursor: base64url(JSON). Callers validate the decoded shape. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function cursorParam<T extends z.ZodType>(shape: T) {
  return z
    .string()
    .max(512, "is too long")
    .transform((raw, ctx) => {
      try {
        const decoded: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        const parsed = shape.safeParse(decoded);
        if (parsed.success) return parsed.data as z.output<T>;
      } catch {
        // fall through
      }
      ctx.addIssue({ code: "custom", message: "is not a valid cursor" });
      return z.NEVER;
    });
}
