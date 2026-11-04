import { describe, expect, it } from "vitest";
import { MAX_EVENTS, parseClientEvents, scrub, sitePath } from "../client-events";

describe("parseClientEvents", () => {
  it("keeps a valid page timing, rounding the numbers", () => {
    const { events, rejected } = parseClientEvents({
      events: [{ type: "page.timing", path: "/", ttfbMs: 41.7, loadMs: 812.2, lcpMs: 640.4 }],
    });
    expect(rejected).toBe(0);
    expect(events).toEqual([{ type: "page.timing", pagePath: "/", ttfbMs: 42, loadMs: 812, lcpMs: 640 }]);
  });

  it("keeps a client error with a same-site source only", () => {
    const { events } = parseClientEvents({
      events: [
        { type: "client.error", path: "/a?x=1", message: "boom", source: "/assets/js/app.js", line: 3, column: 9 },
        { type: "client.error", path: "/b", message: "boom", source: "https://evil.example/x.js" },
      ],
    });
    expect(events[0]).toEqual({
      type: "client.error",
      pagePath: "/a",
      message: "boom",
      source: "/assets/js/app.js",
      line: 3,
      column: 9,
    });
    expect(events[1]).not.toHaveProperty("source");
  });

  it("accepts a single event without the events wrapper", () => {
    expect(parseClientEvents({ type: "page.timing", path: "/" }).events).toHaveLength(1);
  });

  it("drops unknown types, unknown fields and bad values", () => {
    const { events, rejected } = parseClientEvents({
      events: [
        { type: "page.view", path: "/" },
        { type: "page.timing", path: "https://elsewhere/" },
        { type: "page.timing", path: "/", ttfbMs: -5, loadMs: "fast", nhsNumber: "9449306621" },
        null,
      ],
    });
    expect(rejected).toBe(3);
    expect(events).toEqual([{ type: "page.timing", pagePath: "/" }]);
  });

  it("caps the number of events per request", () => {
    const many = Array.from({ length: MAX_EVENTS + 5 }, () => ({ type: "page.timing", path: "/" }));
    const { events, rejected } = parseClientEvents({ events: many });
    expect(events).toHaveLength(MAX_EVENTS);
    expect(rejected).toBe(5);
  });
});

describe("sitePath", () => {
  it("strips the query and fragment, refuses other origins", () => {
    expect(sitePath("/x?token=abc#top")).toBe("/x");
    expect(sitePath("//evil.example/x")).toBeUndefined();
    expect(sitePath("x")).toBeUndefined();
    expect(sitePath(`/${"a".repeat(300)}`)).toBeUndefined();
  });
});

describe("scrub", () => {
  it("removes email addresses and NHS-number-like digits", () => {
    expect(scrub("failed for jo.bloggs@nhs.net")).toBe("failed for [REDACTED]");
    expect(scrub("patient 944 930 6621 missing")).toBe("patient [REDACTED] missing");
  });
  it("collapses whitespace and limits length", () => {
    expect(scrub("a\n\n  b")).toBe("a b");
    expect(scrub("x".repeat(500))).toHaveLength(300);
    expect(scrub("   ")).toBeUndefined();
  });
});
