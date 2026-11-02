import { headers } from "next/headers";
import type { Logger } from "pino";
import { logger } from "./logger";
import { fromXrayTraceId, getTraceContext, toXrayTraceId } from "./telemetry";

/**
 * Names of the request headers that proxy.ts sets for the render.
 * They travel with the request, so any server component or route handler can
 * read them with `headers()` and no logger has to be passed around.
 */
export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_START_HEADER = "x-request-start";
export const REQUEST_PATH_HEADER = "x-request-path";
export const XRAY_TRACE_HEADER = "x-amzn-trace-id";

export type RequestContext = {
  requestId?: string;
  /** OpenTelemetry trace ID (32 hex). From the active span, else the inbound X-Ray header. */
  traceId?: string;
  /** The same trace ID in X-Ray's `1-xxxxxxxx-yyyy...` form, for the X-Ray and CloudWatch consoles. */
  xrayTraceId?: string;
  spanId?: string;
  method?: string;
  path?: string;
  /** Epoch milliseconds when proxy.ts first saw the request. */
  startedAt?: number;
};

/** Reads the request context from headers and the active span. Only callable during a request. */
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const started = h.get(REQUEST_START_HEADER);
  const active = getTraceContext();
  const inboundXray = xrayRoot(h.get(XRAY_TRACE_HEADER));
  const traceId = active.traceId ?? fromXrayTraceId(inboundXray);

  return {
    requestId: h.get(REQUEST_ID_HEADER) ?? undefined,
    traceId,
    xrayTraceId: active.xrayTraceId ?? (traceId ? toXrayTraceId(traceId) : inboundXray),
    spanId: active.spanId,
    path: h.get(REQUEST_PATH_HEADER) ?? undefined,
    startedAt: started ? Number(started) : undefined,
  };
}

/**
 * A logger bound to the current request. Every line it writes carries the
 * request ID, trace ID and path, so a request can be reconstructed from logs
 * and joined to its trace in CloudWatch or X-Ray.
 */
export async function getRequestLogger(): Promise<Logger> {
  const { requestId, traceId, xrayTraceId, spanId, path } = await getRequestContext();
  return logger.child({ requestId, traceId, xrayTraceId, spanId, path });
}

/** Milliseconds elapsed since proxy.ts first saw the request, if known. */
export function elapsedMs(ctx: RequestContext): number | undefined {
  return ctx.startedAt ? Date.now() - ctx.startedAt : undefined;
}

function xrayRoot(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /(?:^|;)\s*Root=([^;]+)/.exec(header);
  return match?.[1];
}
