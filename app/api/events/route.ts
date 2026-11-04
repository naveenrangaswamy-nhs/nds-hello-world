import { MAX_BODY_BYTES, parseClientEvents } from "@/lib/client-events";
import { getRequestLogger } from "@/lib/request-context";

/**
 * Receives browser events from the beacon (lib/beacon-script.ts) and writes
 * each valid one as a `client.event` log line. Returns 204 when at least one
 * event was accepted, 400 when none were, and 413 for an oversized body.
 */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  const { events, rejected } = parseClientEvents(body);
  const log = await getRequestLogger();
  for (const { type, ...fields } of events) {
    log.info({ event: "client.event", clientEvent: type, ...fields });
  }
  if (rejected > 0) log.info({ event: "client.event.rejected", rejected });

  return new Response(null, { status: events.length > 0 ? 204 : 400 });
}
