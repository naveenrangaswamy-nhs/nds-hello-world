import type { Instrumentation } from "next";

/**
 * Next.js instrumentation hooks.
 *
 * `register` runs once per server start (once per Lambda cold start). It
 * starts tracing first so that the very first request is traced, then logs
 * the startup event.
 * `onRequestError` is called by Next for every unhandled server error, so it
 * is the one place that guarantees nothing is missed.
 *
 * Everything is imported dynamically because this file is also evaluated for
 * the Edge runtime, where neither pino nor the OpenTelemetry SDK is available.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startTelemetry } = await import("./lib/telemetry");
  const telemetry = startTelemetry();

  const { logger } = await import("./lib/logger");
  logger.info({
    event: process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda.cold_start" : "server.start",
    nodeVersion: process.version,
    logLevel: logger.level,
    tracing: telemetry.mode,
  });
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger, errorFields } = await import("./lib/logger");
  const { safeRequestId, xrayTraceId } = await import("./lib/anonymise");
  const { fromXrayTraceId } = await import("./lib/telemetry");

  const requestId = safeRequestId(headerValue(request.headers["x-request-id"]));
  const inboundXray = xrayTraceId(headerValue(request.headers["x-amzn-trace-id"]));

  logger.error({
    event: "request.error",
    requestId,
    traceId: fromXrayTraceId(inboundXray),
    xrayTraceId: inboundXray,
    method: request.method,
    path: new URL(request.path, "http://localhost").pathname,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    renderSource: context.renderSource,
    revalidateReason: context.revalidateReason,
    ...errorFields(err),
  });
};

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
