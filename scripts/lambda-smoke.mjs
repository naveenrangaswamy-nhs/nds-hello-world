// Invokes the OpenNext server function locally with API Gateway v2 events,
// exactly as Lambda would, so the deployment artefact can be checked without
// AWS. Run `npm run build:lambda` first.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

process.env.AWS_LAMBDA_FUNCTION_NAME ??= "nhs-helloworld-smoke";
process.env.AWS_REGION ??= "eu-west-2";
process.env.NODE_ENV = "production";

// The OpenNext handler calls process.chdir() when it loads, so resolve every
// path we need up front, relative to the project root.
const projectRoot = process.cwd();
const assetsDir = resolve(projectRoot, ".open-next/assets");
const handlerPath = resolve(projectRoot, ".open-next/server-functions/default/index.mjs");
const { handler } = await import(pathToFileURL(handlerPath).href);

function event(path, headers = {}) {
  const now = Date.now();
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: path,
    rawQueryString: "",
    headers: {
      host: "example.execute-api.eu-west-2.amazonaws.com",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0 Safari/537.36",
      "x-forwarded-for": "81.145.23.200",
      "x-forwarded-proto": "https",
      "x-amzn-trace-id": "Root=1-6a1b2c3d-1234567890abcdef12345678;Sampled=1",
      ...headers,
    },
    requestContext: {
      accountId: "123456789012",
      apiId: "example",
      domainName: "example.execute-api.eu-west-2.amazonaws.com",
      http: { method: "GET", path, protocol: "HTTP/1.1", sourceIp: "81.145.23.200", userAgent: "smoke" },
      requestId: `req-${now}`,
      stage: "$default",
      time: new Date(now).toISOString(),
      timeEpoch: now,
    },
    isBase64Encoded: false,
  };
}

const context = {
  awsRequestId: "00000000-0000-0000-0000-000000000000",
  functionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
  getRemainingTimeInMillis: () => 30_000,
};

let failed = false;
async function check(path, expect, headers) {
  const res = await handler(event(path, headers), context);
  const body = res.isBase64Encoded ? Buffer.from(res.body, "base64").toString() : res.body;
  const ok = res.statusCode === expect.status && (!expect.contains || body.includes(expect.contains));
  failed ||= !ok;
  console.log(`${ok ? "PASS" : "FAIL"} GET ${path} -> ${res.statusCode}` +
    ` x-request-id=${res.headers?.["x-request-id"] ?? "(none)"}` +
    ` content-type=${res.headers?.["content-type"] ?? "?"} bytes=${body.length}`);
  if (!ok) console.log(body.slice(0, 800));
}

await check("/", { status: 200, contains: 'class="nhsuk-heading-xl">Hello world' });
await check("/", { status: 200, contains: "Hello world" }, { "x-request-id": "smoke-request-00001" });
await check("/api/health", { status: 200, contains: '"status":"ok"' });
await check("/does-not-exist", { status: 404 });
// Static files are served from S3 behind CloudFront, not by the server
// function, so check they were emitted into the assets bundle instead.
for (const file of ["assets/manifest.json", "assets/js/nhsuk-frontend.min.js", "BUILD_ID"]) {
  const ok = existsSync(resolve(assetsDir, file));
  failed ||= !ok;
  console.log(`${ok ? "PASS" : "FAIL"} asset bundle contains ${file}`);
}

process.exit(failed ? 1 : 0);
