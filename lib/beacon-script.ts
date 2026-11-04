/**
 * The browser side of POST /api/events, inlined by app/layout.tsx as a plain
 * script (no React client component, in keeping with the rest of the app).
 *
 * It sends two kinds of event, without cookies or any identifier:
 * - `page.timing`: navigation timings and Largest Contentful Paint, once,
 *   when the page is hidden or closed.
 * - `client.error`: uncaught script errors, at most five per page.
 *
 * `navigator.sendBeacon` is used so the request survives the page closing.
 */
export const beaconScript = `(() => {
  const endpoint = "/api/events";
  const path = location.pathname;
  const send = (events) => {
    const body = JSON.stringify({ events });
    const queued = navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
    if (!queued) fetch(endpoint, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  };

  let errors = 0;
  addEventListener("error", (e) => {
    if (errors++ >= 5) return;
    let source;
    try { source = e.filename ? new URL(e.filename).pathname : undefined; } catch {}
    send([{ type: "client.error", path, message: String(e.message || "Error"), source, line: e.lineno, column: e.colno }]);
  });

  let lcp;
  try {
    new PerformanceObserver((list) => {
      const last = list.getEntries().at(-1);
      if (last) lcp = last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  let sent = false;
  const sendTiming = () => {
    const nav = performance.getEntriesByType("navigation")[0];
    if (sent || !nav) return;
    sent = true;
    send([{ type: "page.timing", path, ttfbMs: nav.responseStart, domContentLoadedMs: nav.domContentLoadedEventEnd, loadMs: nav.loadEventEnd || undefined, lcpMs: lcp }]);
  };
  addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sendTiming(); });
  addEventListener("pagehide", sendTiming);
})();`;
