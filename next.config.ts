import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Do not advertise the framework. OpenNext adds its own x-opennext header too.
  poweredByHeader: false,
  // pino resolves transport workers by file path, so it must stay in
  // node_modules rather than being bundled into the server build.
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    // One shared copy of the OpenTelemetry API/SDK so Next's tracer and ours agree.
    "@opentelemetry/api",
    "@opentelemetry/sdk-trace",
    "@opentelemetry/context-async-hooks",
    "@opentelemetry/core",
    "@opentelemetry/resources",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/propagator-aws-xray",
    "@opentelemetry/id-generator-aws-xray",
  ],
  logging: {
    incomingRequests: {
      // Health checks are noise; proxy.ts also excludes them from http.request.
      ignore: [/^\/api\/health/],
    },
  },
  // Cache Components / partial prefetching are intentionally off: this app is
  // fully server-side rendered on every request (see `dynamic` in app/layout.tsx).
  //
  // Note: the dev and build scripts pass `--webpack`. Turbopack's CSS parser
  // (Lightning CSS) currently rejects the `@container scroll-state(...)`
  // queries that NHS.UK frontend v10 uses for scrollable tables.
};

export default nextConfig;
