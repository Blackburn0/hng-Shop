import { expect } from "vitest";

const ORIGIN = "http://localhost:3000";

type Init = { method?: string; token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> };

/** Build a Request as the Next.js runtime would hand it to a route handler. */
export function request(path: string, { method = "GET", token, body, rawBody, headers = {} }: Init = {}) {
  const h = new Headers(headers);
  if (token) h.set("Authorization", `Bearer ${token}`);
  if (body !== undefined || rawBody !== undefined) h.set("Content-Type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: h,
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

export const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

/** Assert an RFC 9457 problem response and return its body. */
export async function expectProblem(res: Response, status: number, instance: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toBe("application/problem+json");
  const body = await res.json();
  expect(body).toMatchObject({ status, instance, type: expect.stringMatching(/^https:\/\//), title: expect.any(String) });
  // No stack traces, database errors or SQL. Whole words only, so a path
  // like /payments/paystack/... isn't mistaken for a "stack" leak.
  expect(JSON.stringify(body)).not.toMatch(/\bstack\b|\bat \S+ \(|\bpostgres|\bsql\b|PGRST\d*|\bP0001\b|\b23505\b/i);
  return body as { status: number; errors?: { field: string; message: string }[]; detail?: string };
}
