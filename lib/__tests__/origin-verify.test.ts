import { describe, expect, it } from "vitest";
import { isFromTrustedOrigin, verifyOrigin } from "../origin-verify";
import { createSecretStore, type Stage } from "../secrets";

describe("isFromTrustedOrigin", () => {
  const secret = "s3cr3t-value";

  it("accepts the matching secret", () => {
    expect(isFromTrustedOrigin(secret, [secret])).toBe(true);
  });
  it("accepts any of several values during a rotation", () => {
    expect(isFromTrustedOrigin("old-value", ["new-value", "old-value"])).toBe(true);
  });
  it("rejects a missing header", () => {
    expect(isFromTrustedOrigin(null, [secret])).toBe(false);
    expect(isFromTrustedOrigin("", [secret])).toBe(false);
  });
  it("rejects a wrong or partial secret", () => {
    expect(isFromTrustedOrigin("s3cr3t-valuX", [secret])).toBe(false);
    expect(isFromTrustedOrigin("s3cr3t", [secret])).toBe(false);
    expect(isFromTrustedOrigin(`${secret}x`, [secret])).toBe(false);
  });
  it("allows everything when no secret is configured", () => {
    expect(isFromTrustedOrigin(null, [])).toBe(true);
  });
});

describe("verifyOrigin", () => {
  const arnEnv = { ORIGIN_VERIFY_SECRET_SECRET_ARN: "arn:secret" };

  it("re-reads Secrets Manager once when it sees an unknown value", async () => {
    let current = "first";
    const reads: Stage[] = [];
    let clock = 0;
    const store = createSecretStore(
      async (_arn, stage) => {
        reads.push(stage);
        return stage === "AWSCURRENT" ? current : undefined;
      },
      arnEnv,
      () => clock,
    );

    expect(await verifyOrigin("first", store)).toBe(true);
    current = "second"; // rotated
    clock = 31_000; // past the refresh throttle, inside the cache TTL
    expect(await verifyOrigin("second", store)).toBe(true);
    expect(reads.filter((s) => s === "AWSCURRENT")).toHaveLength(2);
  });

  it("does not hammer Secrets Manager with repeated bad values", async () => {
    let reads = 0;
    const store = createSecretStore(
      async (_arn, stage) => {
        reads++;
        return stage === "AWSCURRENT" ? "right" : undefined;
      },
      arnEnv,
      () => 0,
    );
    for (let i = 0; i < 5; i++) expect(await verifyOrigin("wrong", store)).toBe(false);
    expect(reads).toBe(3); // one read of the three stages
  });

  it("uses a plain value from the environment when set", async () => {
    const store = createSecretStore(async () => undefined, { ORIGIN_VERIFY_SECRET: "local" });
    expect(await verifyOrigin("local", store)).toBe(true);
    expect(await verifyOrigin("other", store)).toBe(false);
  });

  it("allows everything when nothing is configured", async () => {
    const store = createSecretStore(async () => undefined, {});
    expect(await verifyOrigin(null, store)).toBe(true);
  });
});
