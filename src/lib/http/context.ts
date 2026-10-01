import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export type RequestContext = { requestId: string; traceId?: string };

/** Per-request context, so logs anywhere in a request carry its ID. */
export const requestContext = new AsyncLocalStorage<RequestContext>();

// Accept a caller's X-Request-Id only if it's a sane token, so it can't be
// used to inject fake log lines or bloat logs.
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
// W3C traceparent: version-traceid-parentid-flags
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;

export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get("x-request-id");
  return incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export function traceIdFrom(headers: Headers): string | undefined {
  const id = headers.get("traceparent")?.trim().toLowerCase().match(TRACEPARENT)?.[1];
  return id && !/^0+$/.test(id) ? id : undefined;
}
