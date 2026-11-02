import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

/**
 * OpenNext build configuration for AWS Lambda.
 *
 * This app is fully server-side rendered on every request (see
 * `dynamic = "force-dynamic"` in app/layout.tsx). There is no ISR or SSG, so
 * the incremental cache, tag cache and revalidation queue are switched off.
 * That means no S3 cache bucket, DynamoDB table or SQS queue is needed; the
 * deployment is just the server function, the static assets and a CDN.
 *
 * Build with `npm run build:lambda`. Output lands in `.open-next/`:
 *   server-functions/default/   Lambda handler (index.mjs) for all pages and APIs
 *   assets/                     static files for S3 behind CloudFront
 *   image-optimization-function/ only needed if next/image is used (it is not)
 *   warmer-function/            optional, keeps instances warm
 */
const config = {
  // Our build must use webpack (Turbopack rejects NHS.UK frontend v10 CSS).
  buildCommand: "npm run build",

  default: {
    override: {
      // Buffered Lambda behind API Gateway HTTP API, a Function URL or
      // CloudFront (all use the v2 payload). Switch to
      // `wrapper: "aws-lambda-streaming"` for a streaming Function URL.
      wrapper: "aws-lambda",
      converter: "aws-apigw-v2",
      incrementalCache: "dummy",
      tagCache: "dummy",
      queue: "dummy",
    },
  },

  dangerous: {
    disableIncrementalCache: true,
    disableTagCache: true,
  },

  // The proxy (Next 16's middleware) runs inside the server function.
  middleware: { external: false },
} satisfies OpenNextConfig;

export default config;
