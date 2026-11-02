# NHS Hello World (Next.js)

A hello world application built with [Next.js](https://nextjs.org) and
[NHS.UK frontend](https://github.com/nhsuk/nhsuk-frontend), the code behind the
[NHS design system](https://service-manual.nhs.uk/design-system).

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What is set up

- **Styles**: `app/globals.scss` imports the full design system (`@use "nhsuk-frontend"`),
  compiled with Sass. Extend it with your own SCSS and the NHS Sass variables, mixins and
  utility classes.
- **Fonts**: the Frutiger web font loads from `https://assets.nhs.uk/fonts/` (the design
  system default). It is licensed for NHS use only; other sites fall back to Arial.
- **Assets**: favicons, app icons and the web manifest are copied from the package into
  `public/assets` by `scripts/copy-nhs-assets.mjs` (runs on install and before build).
- **JavaScript**: the design system's ES module bundle is copied to `public/assets/js` and
  loaded by a plain `<script type="module">` in `app/layout.tsx`, which calls `initAll()`
  so components such as the header menu work. There are no React client components.
- **Page template**: `app/layout.tsx` mirrors the NHS.UK frontend page template with a
  skip link, header, `nhsuk-width-container` / `nhsuk-main-wrapper`, footer, NHS page
  title format (`Page - Service - NHS`), theme colour and icons.
- **Components**: `components/Header.tsx`, `components/Footer.tsx` and
  `components/SkipLink.tsx` render the same markup as the design system's Nunjucks macros.

## Rendering

Every route is server-side rendered on each request:

- `app/layout.tsx` exports `dynamic = "force-dynamic"`, which all child segments inherit.
  Nothing is prerendered at build time and no data is cached.
- `cacheComponents` and `partialPrefetching` are off in `next.config.ts` (they would
  prerender and cache static parts of the page).
- Every component is a React Server Component; nothing in the app uses `"use client"`.
  NHS.UK frontend JavaScript is a static module script, not part of the React tree.
- The home page prints the server render time as a visible check.

## Logging and request tracing

Structured logging is built in and works the same locally and on AWS Lambda.

- **Logger**: `lib/logger.ts` configures [pino](https://getpino.io). Production writes JSON to
  stdout with a synchronous destination (nothing is lost when Lambda freezes the
  environment after a response). Development pretty-prints. Set `LOG_LEVEL` and
  `LOG_FORMAT` (see `.env.example`).
- **Redaction**: fields that could identify a person or carry a secret (NHS number, email,
  names, date of birth, postcode, cookies, tokens and more) are replaced with
  `[REDACTED]` before a line is written. The list is in `lib/logger.ts`.
- **Correlation ID**: `proxy.ts` runs before every page and API request. It honours a
  well-formed inbound `x-request-id` or generates a UUID, forwards it to the render and
  returns it in the response, so support can ask a user to quote it. It also extracts the
  X-Ray trace ID from `x-amzn-trace-id` when present.
- **Request-scoped logging**: call `await getRequestLogger()` from
  `lib/request-context.ts` in any server component or route handler. Lines it writes
  carry `requestId`, `traceId` and `path` automatically.
- **Events, not sentences**: every line has an `event` field (`http.request`,
  `page.render`, `request.error`, `server.start`, `lambda.cold_start`) so dashboards and
  alarms can filter on it.
- **Server errors**: `instrumentation.ts` exports `onRequestError`, which Next calls for
  every unhandled server error, logging it with the request ID and route details.
- **Anonymised client details**: IPs are truncated to /24 (IPv6 /48) and user agents
  reduced to browser family and major version (`lib/anonymise.ts`).
- **Health check**: `GET /api/health` returns status and version and is excluded from
  request logging.

Run `npm test` for the redaction and anonymisation tests.

## Tracing (OpenTelemetry)

`lib/telemetry.ts` sets up OpenTelemetry tracing and `instrumentation.ts` starts it before the
first request. Next.js emits spans for every request, render and `fetch`; add your own with
`withSpan(name, fn, attributes)` for database calls, downstream APIs and journey milestones.

Who owns the tracer depends on the environment:

| Mode | When | Behaviour |
| --- | --- | --- |
| `layer` | AWS Lambda with the ADOT Node.js layer and `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler` | The layer registers the provider before the app loads, owns X-Ray propagation and export, and force-flushes after every invocation. The app registers nothing; all spans flow to it. **Recommended for Lambda.** |
| `otlp` | Anywhere with a collector: containers, Lambda with a collector-only layer, local Jaeger | The app exports OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT`. On Lambda each span is exported as it ends, because the process is frozen right after the response. |
| `console` | `OTEL_TRACES_EXPORTER=console` | Spans printed to stdout for local debugging. |
| `off` | No exporter configured | Nothing registered; the tracer is a no-op. |

Details:

- **X-Ray compatible IDs**: trace IDs are generated in X-Ray's timestamp-prefixed form so the
  ADOT collector can forward them to X-Ray unchanged.
- **Inbound context** is accepted from W3C `traceparent`/`baggage` and from API Gateway or
  ALB `x-amzn-trace-id`, so a trace started at the edge continues into the render. The proxy
  injects the context into the request it forwards, so the proxy span and the render share a
  trace even when the client sent none.
- **Logs and traces share IDs**: every request-scoped log line carries `traceId` (OpenTelemetry
  hex), `xrayTraceId` (the `1-xxxxxxxx-...` form the X-Ray and CloudWatch consoles search on)
  and `spanId`, taken from the active span. Without a tracer they fall back to the inbound
  X-Ray header.
- **Sampling** uses the standard `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` variables.
- **Local tracing**: run Jaeger and point the app at it:

  ```bash
  docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:2.8.0
  OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev
  ```

  Then open http://localhost:16686.

### Lambda deployment notes

- Attach the **ADOT Node.js Lambda layer** and set `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler`,
  `OTEL_PROPAGATORS=xray,tracecontext,baggage` and `OTEL_SERVICE_NAME`. Enable active tracing
  on the function so API Gateway and Lambda segments join the same trace.
- Enable **CloudWatch Application Signals** for the service map, per-route latency and SLOs.
- The layer adds a few hundred milliseconds to cold starts; use provisioned concurrency on the
  server function if that matters for users.

## Deploying to AWS Lambda with OpenNext

[OpenNext](https://opennext.js.org/aws) turns the Next.js build into Lambda-ready bundles.
It is configured in `open-next.config.ts`.

```bash
npm run build:lambda   # next build (webpack) + OpenNext bundling -> .open-next/
npm run lambda:smoke   # invoke the server function locally with API Gateway events
```

The smoke test needs no AWS account. It loads the generated handler, sends requests for
the home page, the health check and a missing page, and checks the asset bundle.

### What the build produces

| Path | Deploy as | Notes |
| --- | --- | --- |
| `.open-next/server-functions/default/` | Lambda, handler `index.handler`, Node 22+ | All pages, the proxy and API routes. Buffered responses (API Gateway v2 payload, also used by Function URLs and CloudFront). |
| `.open-next/assets/` | S3 bucket behind CloudFront | `_next/*` is content-hashed: cache `public,max-age=31536000,immutable`. Everything else (`assets/*`, `BUILD_ID`): `public,max-age=0,s-maxage=31536000,must-revalidate` and invalidate on deploy. |
| `.open-next/image-optimization-function/` | Optional | Only needed if `next/image` is used. It is not, so this can be left undeployed. |
| `.open-next/warmer-function/` | Optional | Scheduled invoker that keeps server instances warm. Provisioned concurrency is the simpler alternative. |
| `.open-next/revalidation-function/` | Not needed | ISR is disabled. |
| `.open-next/open-next.output.json` | Reference | Machine-readable list of origins and CloudFront behaviours. |

CloudFront behaviours, from `open-next.output.json`: `_next/*`, `assets/*` and `BUILD_ID` go
to S3; everything else goes to the server function.

### Why no cache infrastructure

Every route is `force-dynamic`, so there is no ISR or SSG output to cache. The config sets the
incremental cache, tag cache and queue to `dummy` and disables them under `dangerous`. No S3
cache bucket, DynamoDB table or SQS queue is required. If you later add cached or static
routes, remove those overrides and provision the standard OpenNext cache resources.

### Server function settings

- Environment: `APP_ENV`, `APP_VERSION` (git SHA from CI), `LOG_LEVEL`, plus the tracing
  variables from the section above (`AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler` with the ADOT
  layer, `OTEL_PROPAGATORS=xray,tracecontext,baggage`, `OTEL_SERVICE_NAME`).
- Memory 1024 MB or more and a 30 second timeout are sensible starting points for SSR.
- Enable active tracing on the function and attach the ADOT Node.js layer.
- Logs go to CloudWatch from stdout; set the log group retention explicitly.

### Infrastructure options

OpenNext does not create infrastructure. Pick one:

- **SST** (maintained by the OpenNext team): `npx sst@latest init` in this directory.
- **Terraform**: [nhs-england-tools/terraform-aws-opennext](https://github.com/nhs-england-tools/terraform-aws-opennext)
  is published by NHS England. Check that its release supports the OpenNext v4 output layout
  before relying on it; otherwise [RJPearson94/terraform-aws-open-next](https://github.com/RJPearson94/terraform-aws-open-next).
- **CDK**: [cdk-nextjs](https://github.com/jetbridge/cdk-nextjs).

## Why `--webpack`?

The `dev` and `build` scripts pass `--webpack`. Turbopack's CSS parser currently rejects
the `@container scroll-state(...)` queries used by NHS.UK frontend v10 for scrollable
tables. Once that is supported upstream, drop the flag from `package.json`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (copies NHS assets first) |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests (vitest) |
| `npm run nhs:assets` | Re-copy NHS.UK frontend static assets |
| `npm run build:lambda` | OpenNext build for AWS Lambda (output in `.open-next/`) |
| `npm run lambda:smoke` | Invoke the built Lambda handler locally |
