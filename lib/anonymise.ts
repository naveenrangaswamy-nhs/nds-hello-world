/**
 * Helpers that reduce request metadata to a form safe to log.
 * Nothing here should ever let a log line identify a person or device.
 */

/** Truncates an IP address to a coarse prefix (IPv4 /24, IPv6 /48). */
export function truncateIp(ip: string | null | undefined): string | undefined {
  if (!ip) return undefined;
  const value = ip.trim().split(",")[0].trim(); // first hop of x-forwarded-for
  if (value.includes(":")) {
    const groups = expandIpv6(value);
    return groups ? `${groups.slice(0, 3).join(":")}::/48` : undefined;
  }
  const octets = value.split(".");
  if (octets.length !== 4 || octets.some((o) => !/^\d{1,3}$/.test(o))) return undefined;
  return `${octets.slice(0, 3).join(".")}.0/24`;
}

/** Expands a compressed IPv6 address (`::`) to its 8 hextets, or undefined if malformed. */
function expandIpv6(value: string): string[] | undefined {
  const [addr] = value.split("%"); // drop zone index
  const halves = addr.split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => g.toLowerCase());
}

const UA_PATTERNS: Array<[string, RegExp]> = [
  ["Edge", /\bEdg(?:e|A|iOS)?\/(\d+)/],
  ["Samsung Internet", /\bSamsungBrowser\/(\d+)/],
  ["Opera", /\bOPR\/(\d+)/],
  ["Chrome", /\bChrome\/(\d+)/],
  ["Firefox", /\bFirefox\/(\d+)/],
  ["Safari", /\bVersion\/(\d+)[^)]*\bSafari\//],
];

/** Reduces a user agent string to browser family and major version only. */
export function uaFamily(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  for (const [family, pattern] of UA_PATTERNS) {
    const match = pattern.exec(userAgent);
    if (match) return `${family} ${match[1]}`;
  }
  if (/\bbot\b|crawler|spider|curl|wget/i.test(userAgent)) return "Bot";
  return "Other";
}

/** Parses the X-Ray `Root=` trace ID from an `x-amzn-trace-id` header value. */
export function xrayTraceId(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const match = /(?:^|;)\s*Root=([^;]+)/.exec(header);
  return match?.[1];
}

/** Accepts an inbound request ID only if it is short and plain. */
export function safeRequestId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^[A-Za-z0-9._-]{8,64}$/.test(value) ? value : undefined;
}
