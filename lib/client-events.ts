/**
 * Events sent by the browser to POST /api/events (see lib/beacon-script.ts).
 *
 * Anyone can post to the endpoint, so the body is treated as hostile: only
 * the known event types and fields are kept, numbers are bounded, paths lose
 * their query string, and free text is cut short with anything that looks
 * like an email address or NHS number removed. Nothing in an event can
 * identify the person or device that sent it.
 */

export const MAX_BODY_BYTES = 8 * 1024;
export const MAX_EVENTS = 10;

export type PageTiming = {
  type: "page.timing";
  pagePath: string;
  ttfbMs?: number;
  domContentLoadedMs?: number;
  loadMs?: number;
  lcpMs?: number;
};

export type ClientError = {
  type: "client.error";
  pagePath: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
};

export type ClientEvent = PageTiming | ClientError;

/** Keeps the valid events from a request body and counts the rest. */
export function parseClientEvents(body: unknown): { events: ClientEvent[]; rejected: number } {
  const list = Array.isArray((body as { events?: unknown })?.events)
    ? (body as { events: unknown[] }).events
    : [body];
  const events: ClientEvent[] = [];
  let rejected = 0;
  for (const item of list.slice(0, MAX_EVENTS)) {
    const event = parseEvent(item);
    if (event) events.push(event);
    else rejected++;
  }
  rejected += Math.max(0, list.length - MAX_EVENTS);
  return { events, rejected };
}

function parseEvent(raw: unknown): ClientEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const e = raw as Record<string, unknown>;
  const pagePath = sitePath(e.path);
  if (!pagePath) return undefined;

  if (e.type === "page.timing") {
    return compact<PageTiming>({
      type: "page.timing",
      pagePath,
      ttfbMs: duration(e.ttfbMs),
      domContentLoadedMs: duration(e.domContentLoadedMs),
      loadMs: duration(e.loadMs),
      lcpMs: duration(e.lcpMs),
    });
  }
  if (e.type === "client.error") {
    const message = scrub(e.message);
    if (!message) return undefined;
    return compact<ClientError>({
      type: "client.error",
      pagePath,
      message,
      source: sitePath(e.source),
      line: integer(e.line),
      column: integer(e.column),
    });
  }
  return undefined;
}

/** A same-site path without its query string or fragment, or undefined. */
export function sitePath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return undefined;
  const path = value.split(/[?#]/)[0];
  return path.length <= 200 ? path : undefined;
}

function duration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 600_000
    ? Math.round(value)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000
    ? value
    : undefined;
}

/** Short, single-line text with email addresses and long digit runs removed. */
export function scrub(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[REDACTED]")
    .replace(/\d[\d\s-]{8,}\d/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return text || undefined;
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
