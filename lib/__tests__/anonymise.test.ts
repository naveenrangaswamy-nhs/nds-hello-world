import { describe, expect, it } from "vitest";
import { safeRequestId, truncateIp, uaFamily, xrayTraceId } from "../anonymise";

describe("truncateIp", () => {
  it("reduces IPv4 to a /24 prefix", () => {
    expect(truncateIp("81.145.23.200")).toBe("81.145.23.0/24");
  });
  it("uses the first hop of x-forwarded-for", () => {
    expect(truncateIp("10.1.2.3, 172.16.0.1")).toBe("10.1.2.0/24");
  });
  it("reduces IPv6 to a /48 prefix", () => {
    expect(truncateIp("2a00:23c4:1234:5678::1")).toBe("2a00:23c4:1234::/48");
  });
  it("expands compressed IPv6 before truncating", () => {
    expect(truncateIp("::1")).toBe("0:0:0::/48");
    expect(truncateIp("2001:db8::8a2e:370:7334")).toBe("2001:db8:0::/48");
    expect(truncateIp("fe80::1%eth0")).toBe("fe80:0:0::/48");
  });
  it("returns undefined for junk", () => {
    expect(truncateIp("1:::2")).toBeUndefined();
    expect(truncateIp("zzzz::1")).toBeUndefined();
    expect(truncateIp("not-an-ip")).toBeUndefined();
    expect(truncateIp(null)).toBeUndefined();
  });
});

describe("uaFamily", () => {
  it("keeps only browser family and major version", () => {
    expect(
      uaFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.70 Safari/537.36 Edg/130.0.2849.56",
      ),
    ).toBe("Edge 130");
    expect(
      uaFamily(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 17");
    expect(uaFamily("curl/8.4.0")).toBe("Bot");
  });
});

describe("xrayTraceId", () => {
  it("extracts the Root segment", () => {
    expect(xrayTraceId("Root=1-5759e988-bd862e3fe1be46a994272793;Parent=53995c3f42cd8ad8;Sampled=1")).toBe(
      "1-5759e988-bd862e3fe1be46a994272793",
    );
  });
});

describe("safeRequestId", () => {
  it("accepts plain IDs and rejects anything else", () => {
    expect(safeRequestId("3f2c1d9e-9d3c-4b2a-8f0e-2a7b6c5d4e3f")).toBe("3f2c1d9e-9d3c-4b2a-8f0e-2a7b6c5d4e3f");
    expect(safeRequestId("<script>alert(1)</script>")).toBeUndefined();
    expect(safeRequestId("short")).toBeUndefined();
  });
});
