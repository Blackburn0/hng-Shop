import type { z } from "zod";

// RFC 9457 Problem Details. `type` URIs are stable identifiers, not live pages.
const TYPE_BASE = "https://coffee-shop.local/problems";

export type FieldError = { field: string; message: string };

type ProblemInit = {
  status: number;
  type: string;
  title: string;
  detail?: string;
  instance?: string;
  errors?: FieldError[];
  headers?: HeadersInit;
};

export function problem({ status, type, title, detail, instance, errors, headers }: ProblemInit): Response {
  const body = { type: `${TYPE_BASE}/${type}`, title, status, detail, instance, errors };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

export function zodFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? " is" : "s are"} invalid`;
}

export const problems = {
  badRequest: (instance: string, error: z.ZodError) => {
    const errors = zodFieldErrors(error);
    return problem({
      status: 400,
      type: "bad-request",
      title: "Invalid request parameters",
      detail: plural(errors.length, "parameter"),
      instance,
      errors,
    });
  },
  validation: (instance: string, error: z.ZodError) => {
    const errors = zodFieldErrors(error);
    return problem({
      status: 422,
      type: "validation-error",
      title: "Request validation failed",
      detail: plural(errors.length, "field"),
      instance,
      errors,
    });
  },
  malformedJson: (instance: string) =>
    problem({ status: 400, type: "malformed-json", title: "Request body is not valid JSON", instance }),
  unauthorized: (instance: string) =>
    problem({
      status: 401,
      type: "unauthorized",
      title: "Authentication required",
      detail: "Sign in and try again.",
      instance,
      headers: { "WWW-Authenticate": "Bearer" },
    }),
  notFound: (instance: string, detail?: string) =>
    problem({ status: 404, type: "not-found", title: "Resource not found", detail, instance }),
  conflict: (instance: string, detail: string) =>
    problem({ status: 409, type: "conflict", title: "Request conflicts with current state", detail, instance }),
  internal: (instance: string) =>
    problem({ status: 500, type: "internal-error", title: "Something went wrong", instance }),
  tooLarge: (instance: string, maxBytes: number) =>
    problem({
      status: 413,
      type: "payload-too-large",
      title: "Payload too large",
      detail: `Request bodies are limited to ${Math.round(maxBytes / 1024)} KB.`,
      instance,
    }),
};

const DEFAULT_MAX_JSON_BYTES = 16 * 1024;

type JsonResult = { ok: true; value: unknown } | { ok: false; error: Response };

/**
 * Read and parse a JSON body, enforcing a size limit even when the client sent
 * no Content-Length. On failure, `error` is the ready-made 400/413 response.
 */
export async function readJson(req: Request, maxBytes = DEFAULT_MAX_JSON_BYTES): Promise<JsonResult> {
  const { pathname } = new URL(req.url);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, error: problems.malformedJson(pathname) };
  }
  if (Buffer.byteLength(raw) > maxBytes) return { ok: false, error: problems.tooLarge(pathname, maxBytes) };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: problems.malformedJson(pathname) };
  }
}
