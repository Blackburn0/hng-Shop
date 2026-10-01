import { requestContext, requestIdFrom, traceIdFrom } from "@/lib/http/context";
import { problem, problems } from "@/lib/http/problem";
import { clientIp, hit, type Limit } from "@/lib/http/rate-limit";
import { log } from "@/lib/log";

export const MAX_JSON_BODY_BYTES = 16 * 1024;

type Options = {
  /** bucket name, e.g. "orders.create"; limits are per client IP per bucket */
  rateLimit?: { bucket: string } & Limit;
  /** reject bodies whose Content-Length is larger (default 16 KB for write methods) */
  maxBodyBytes?: number;
};

type Handler<C, R extends Request> = (req: R, ctx: C) => Response | Promise<Response>;

/**
 * Wrap a route handler with the cross-cutting HTTP concerns:
 *  - X-Request-Id (accepted from the caller or generated) on the response and in every log line
 *  - W3C traceparent trace ID in logs
 *  - per-IP rate limiting -> 429 with Retry-After and RateLimit-* headers
 *  - request body size limit -> 413
 *  - unhandled errors -> 500 problem details (details only in the log)
 *  - one structured access-log line per request
 */
export function route<C = unknown, R extends Request = Request>(options: Options, handler: Handler<C, R>) {
  // Routes without params can be called with just the request; dynamic routes require ctx.
  type Args = undefined extends C ? [ctx?: C] : [ctx: C];
  return async (req: R, ...[ctx]: Args): Promise<Response> => {
    const requestId = requestIdFrom(req.headers);
    const traceId = traceIdFrom(req.headers);
    const { pathname } = new URL(req.url);
    const started = performance.now();

    return requestContext.run({ requestId, traceId }, async () => {
      const extra = new Headers({ "X-Request-Id": requestId });
      let res: Response | undefined;

      if (options.rateLimit) {
        const { bucket, ...limit } = options.rateLimit;
        const decision = hit(`${bucket}:${clientIp(req.headers)}`, limit);
        const resetSeconds = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
        extra.set("RateLimit-Limit", String(decision.limit));
        extra.set("RateLimit-Remaining", String(decision.remaining));
        extra.set("RateLimit-Reset", String(resetSeconds));
        if (!decision.ok) {
          extra.set("Retry-After", String(resetSeconds));
          log.warn("rate limited", { bucket, path: pathname });
          res = problem({
            status: 429,
            type: "rate-limited",
            title: "Too many requests",
            detail: `Please wait ${resetSeconds} seconds and try again.`,
            instance: pathname,
          });
        }
      }

      const isWrite = req.method !== "GET" && req.method !== "HEAD";
      const maxBody = options.maxBodyBytes ?? (isWrite ? MAX_JSON_BODY_BYTES : undefined);
      if (!res && maxBody !== undefined && Number(req.headers.get("content-length") ?? 0) > maxBody) {
        res = problems.tooLarge(pathname, maxBody);
      }

      if (!res) {
        try {
          res = await handler(req, ctx as C);
        } catch (err) {
          log.error("unhandled error", { path: pathname, err });
          res = problems.internal(pathname);
        }
      }

      const out = withHeaders(res, extra);
      log.info("request", {
        method: req.method,
        path: pathname,
        status: out.status,
        durationMs: Math.round(performance.now() - started),
      });
      return out;
    });
  };
}

/** Copy a response with extra headers (Response.redirect() headers are immutable). */
function withHeaders(res: Response, extra: Headers): Response {
  const headers = new Headers(res.headers);
  extra.forEach((value, key) => headers.set(key, value));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
