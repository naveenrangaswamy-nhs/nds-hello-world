import { describe, expect, it } from "vitest";
import { isFromTrustedOrigin } from "../origin-verify";

describe("isFromTrustedOrigin", () => {
  const secret = "s3cr3t-value";

  it("accepts the matching secret", () => {
    expect(isFromTrustedOrigin(secret, secret)).toBe(true);
  });
  it("rejects a missing header", () => {
    expect(isFromTrustedOrigin(null, secret)).toBe(false);
    expect(isFromTrustedOrigin("", secret)).toBe(false);
  });
  it("rejects a wrong or partial secret", () => {
    expect(isFromTrustedOrigin("s3cr3t-valuX", secret)).toBe(false);
    expect(isFromTrustedOrigin("s3cr3t", secret)).toBe(false);
    expect(isFromTrustedOrigin(`${secret}x`, secret)).toBe(false);
  });
  it("allows everything when no secret is configured", () => {
    expect(isFromTrustedOrigin(null, undefined)).toBe(true);
    expect(isFromTrustedOrigin(null, "")).toBe(true);
  });
});
