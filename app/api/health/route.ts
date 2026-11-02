import { NextResponse } from "next/server";

/** Liveness check for load balancers and synthetic canaries. Not logged. */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: process.env.SERVICE_NAME ?? "nhs-helloworld",
      version: process.env.APP_VERSION ?? "dev",
      time: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
