import { context, propagation } from "@opentelemetry/api";
import { NextResponse, type NextRequest } from "next/server";
import { safeRequestId, truncateIp, uaFamily, xrayTraceId } from "@/lib/anonymise";
import { logger } from "@/lib/logger";
import { fromXrayTraceId, getTraceContext } from "@/lib/telemetry";
import {
  REQUEST_ID_HEADER,
  REQUEST_PATH_HEADER,
  REQUEST_START_HEADER,
  XRAY_TRACE_HEADER,
} from "@/lib/request-context";

/**
 * Runs in front of every page and API request (static assets are excluded
 * by the matcher below).
 *
 * - Assigns a correlation ID: an inbound `x-request-id` is honoured if it is
 *   well formed, otherwise a UUID is generated. It is forwarded to the render
 *   as a request header and returned to the client as a response header, so
 *   support can ask a user for it.
 * - Records the request start time and path so the layout can log how long
 *   the render took.
 * - Writes one `http.request` line with anonymised client details.
 */
export function proxy(request: NextRequest) {
  const requestId = safeRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();
  const inboundXray = xrayTraceId(request.headers.get(XRAY_TRACE_HEADER));
  const active = getTraceContext();
  const traceId = active.traceId ?? fromXrayTraceId(inboundXray);
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  requestHeaders.set(REQUEST_START_HEADER, String(Date.now()));
  requestHeaders.set(REQUEST_PATH_HEADER, pathname);
  // Next runs the proxy and the render as separate handlers. Injecting the
  // active trace context (W3C traceparent + X-Ray header) into the forwarded
  // request keeps them on one trace even when the client sent none.
  propagation.inject(context.active(), requestHeaders, headersSetter);

  logger.info({
    event: "http.request",
    requestId,
    traceId,
    xrayTraceId: active.xrayTraceId ?? inboundXray,
    method: request.method,
    path: pathname,
    referrerPath: referrerPath(request.headers.get("referer")),
    ipPrefix: truncateIp(
      request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
    ),
    browser: uaFamily(request.headers.get("user-agent")),
    acceptLanguage: request.headers.get("accept-language")?.split(",")[0]?.trim(),
  });

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

const headersSetter = {
  set: (carrier: Headers, key: string, value: string) => carrier.set(key, value),
};

/** Keeps only the path of a same-origin referrer; drops query strings and other origins. */
function referrerPath(referer: string | null): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).pathname;
  } catch {
    return undefined;
  }
}

export const config = {
  // Everything except Next internals, the NHS static assets and favicons.
  matcher: ["/((?!_next/static|_next/image|assets/|api/health|favicon\\.ico).*)"],
};
