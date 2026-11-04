import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { AWSXRayIdGenerator } from "@opentelemetry/id-generator-aws-xray";
import { AWSXRayPropagator } from "@opentelemetry/propagator-aws-xray";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type SpanExporter,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace";
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

/**
 * OpenTelemetry tracing.
 *
 * Next.js emits spans for every request, render and fetch through the
 * `@opentelemetry/api` global tracer. This module decides who owns that
 * global:
 *
 * - "layer"   AWS Lambda with the ADOT Node.js layer and
 *             `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument`. The layer registers
 *             the provider before the app loads, owns X-Ray propagation and
 *             export, and force-flushes at the end of every invocation. We
 *             register nothing; Next's spans and ours flow to it.
 * - "otlp"    Everywhere else that has a collector (containers, Lambda with a
 *             collector-only layer, local Jaeger). We register a provider that
 *             exports OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT`.
 * - "console" Local debugging: spans printed to stdout.
 * - "off"     No exporter configured. Nothing is registered and Next's
 *             tracer is a no-op.
 *
 * Trace IDs are always X-Ray compatible (timestamp-prefixed) so the ADOT
 * collector can forward them to X-Ray unchanged. Inbound context is accepted
 * from W3C `traceparent` and from API Gateway / ALB `x-amzn-trace-id`.
 */

export const SERVICE_NAME =
  process.env.OTEL_SERVICE_NAME ?? process.env.SERVICE_NAME ?? "nhs-helloworld";

export type TelemetryMode = "layer" | "otlp" | "console" | "off";

export type TelemetryOptions = {
  /** Override the exporter (used by tests). */
  exporter?: SpanExporter;
};

export type Telemetry = {
  mode: TelemetryMode;
  provider?: TracerProvider;
};

const globalForTelemetry = globalThis as unknown as { __nhsTelemetry?: Telemetry };

/** Starts tracing once per process. Safe to call repeatedly (dev hot reload). */
export function startTelemetry(options: TelemetryOptions = {}): Telemetry {
  if (globalForTelemetry.__nhsTelemetry) return globalForTelemetry.__nhsTelemetry;

  const telemetry = createTelemetry(options);
  globalForTelemetry.__nhsTelemetry = telemetry;
  return telemetry;
}

function createTelemetry({ exporter }: TelemetryOptions): Telemetry {
  if (process.env.AWS_LAMBDA_EXEC_WRAPPER) return { mode: "layer" };

  const mode = resolveMode(exporter);
  if (mode === "off") return { mode };

  const spanExporter =
    exporter ?? (mode === "console" ? new ConsoleSpanExporter() : new OTLPTraceExporter());

  const provider = new TracerProvider({
    resource: defaultResource().merge(resourceFromAttributes(resourceAttributes())),
    idGenerator: new AWSXRayIdGenerator(),
    spanProcessors: [createSpanProcessor(spanExporter)],
  });

  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
        new AWSXRayPropagator(),
      ],
    }),
  );
  trace.setGlobalTracerProvider(provider);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      void provider.shutdown().finally(() => process.exit(0));
    });
  }

  return { mode, provider };
}

function resolveMode(exporter?: SpanExporter): TelemetryMode {
  if (exporter) return "otlp";
  const requested = process.env.OTEL_TRACES_EXPORTER?.toLowerCase();
  if (requested === "none") return "off";
  if (requested === "console") return "console";
  if (requested === "otlp") return "otlp";
  const hasEndpoint =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  return hasEndpoint ? "otlp" : "off";
}

function createSpanProcessor(exporter: SpanExporter): SpanProcessor {
  // On Lambda the process is frozen as soon as the response is sent, so a
  // batching delay would hold spans until the next invocation. Export each
  // span immediately; the collector is on localhost so this is cheap.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME || exporter instanceof ConsoleSpanExporter) {
    return new SimpleSpanProcessor({ exporter });
  }
  return new BatchSpanProcessor({ exporter, scheduledDelayMillis: 1000 });
}

function resourceAttributes(): Attributes {
  return {
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]:
      process.env.APP_VERSION ?? process.env.npm_package_version ?? "dev",
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
      process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
    ...(process.env.AWS_LAMBDA_FUNCTION_NAME && {
      "cloud.provider": "aws",
      "cloud.region": process.env.AWS_REGION,
      "faas.name": process.env.AWS_LAMBDA_FUNCTION_NAME,
      "faas.version": process.env.AWS_LAMBDA_FUNCTION_VERSION,
    }),
  };
}

/** Trace identifiers for the span active in the current async context, if any. */
export function getTraceContext(): { traceId?: string; spanId?: string; xrayTraceId?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};
  return {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    xrayTraceId: toXrayTraceId(spanContext.traceId),
  };
}

/** `4bf92f3577b34da6a3ce929d0e0e4736` -> `1-4bf92f35-77b34da6a3ce929d0e0e4736` */
export function toXrayTraceId(traceId: string): string {
  return `1-${traceId.slice(0, 8)}-${traceId.slice(8)}`;
}

/** `1-4bf92f35-77b34da6a3ce929d0e0e4736` -> `4bf92f3577b34da6a3ce929d0e0e4736` */
export function fromXrayTraceId(xrayTraceId: string | undefined): string | undefined {
  const match = /^1-([0-9a-f]{8})-([0-9a-f]{24})$/i.exec(xrayTraceId ?? "");
  return match ? `${match[1]}${match[2]}`.toLowerCase() : undefined;
}

/**
 * Runs `fn` inside a new span. Errors are recorded on the span and rethrown.
 * Use for anything worth seeing on a trace: database calls, downstream APIs,
 * journey milestones.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Attributes,
): Promise<T> {
  return trace.getTracer(SERVICE_NAME).startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}
