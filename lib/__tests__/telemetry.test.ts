import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { beforeAll, describe, expect, it } from "vitest";
import { fromXrayTraceId, getTraceContext, startTelemetry, toXrayTraceId, withSpan } from "../telemetry";

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  startTelemetry({ exporter });
});

describe("X-Ray trace ID conversion", () => {
  it("round-trips between OpenTelemetry and X-Ray formats", () => {
    const hex = "4bf92f3577b34da6a3ce929d0e0e4736";
    expect(toXrayTraceId(hex)).toBe("1-4bf92f35-77b34da6a3ce929d0e0e4736");
    expect(fromXrayTraceId("1-4bf92f35-77b34da6a3ce929d0e0e4736")).toBe(hex);
  });
  it("rejects malformed X-Ray IDs", () => {
    expect(fromXrayTraceId("Root=1-abc")).toBeUndefined();
    expect(fromXrayTraceId(undefined)).toBeUndefined();
  });
});

describe("withSpan", () => {
  it("creates an exported span, exposes its IDs to getTraceContext, and generates X-Ray compatible IDs", async () => {
    let seen: ReturnType<typeof getTraceContext> = {};
    await withSpan("unit.test", () => {
      seen = getTraceContext();
    }, { "test.attr": 1 });

    await startTelemetry().provider!.forceFlush();
    const span = exporter.getFinishedSpans().find((s) => s.name === "unit.test");
    expect(span).toBeDefined();
    expect(span!.attributes["test.attr"]).toBe(1);
    expect(seen.traceId).toBe(span!.spanContext().traceId);
    expect(seen.xrayTraceId).toBe(toXrayTraceId(span!.spanContext().traceId));

    // X-Ray IDs start with the epoch seconds, so the first 8 hex chars decode to roughly now.
    const epochSeconds = parseInt(span!.spanContext().traceId.slice(0, 8), 16);
    expect(Math.abs(epochSeconds - Date.now() / 1000)).toBeLessThan(60);
  });

  it("records errors on the span and rethrows", async () => {
    await expect(withSpan("unit.error", () => { throw new Error("nope"); })).rejects.toThrow("nope");
    await startTelemetry().provider!.forceFlush();
    const span = exporter.getFinishedSpans().find((s) => s.name === "unit.error");
    expect(span!.status.code).toBe(2); // SpanStatusCode.ERROR
    expect(span!.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("returns an empty context outside any span", () => {
    expect(trace.getActiveSpan()).toBeUndefined();
    expect(getTraceContext()).toEqual({});
  });
});
