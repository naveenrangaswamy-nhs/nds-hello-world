import pino from "pino";
import { describe, expect, it } from "vitest";
import { audit, userRef } from "../audit";
import { matchSteps, type Funnel } from "../funnels";
import { journeyIdFor, linkJourney, recordJourneyStep } from "../journey";
import { pseudonym } from "../pseudonym";
import { createSecretStore } from "../secrets";

const store = createSecretStore(async () => undefined, {
  JOURNEY_HMAC_KEY: "journey-key",
  USER_REF_HMAC_KEY: "user-key",
});
const unconfigured = createSecretStore(async () => undefined, {});

/** A pino logger that collects lines in memory. */
function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const log = pino({ base: undefined, timestamp: false }, {
    write: (line: string) => lines.push(JSON.parse(line)),
  });
  return { log, lines };
}

describe("pseudonym", () => {
  it("is stable, prefixed and 22 characters after the prefix", () => {
    const a = pseudonym("u", "subject-1", "key");
    expect(a).toBe(pseudonym("u", "subject-1", "key"));
    expect(a).toMatch(/^u_[A-Za-z0-9_-]{22}$/);
  });
  it("changes with the key and the input", () => {
    const a = pseudonym("u", "subject-1", "key");
    expect(pseudonym("u", "subject-1", "other-key")).not.toBe(a);
    expect(pseudonym("u", "subject-2", "key")).not.toBe(a);
  });
  it("refuses empty input or key", () => {
    expect(() => pseudonym("u", "", "key")).toThrow();
    expect(() => pseudonym("u", "x", "")).toThrow();
  });
});

describe("userRef", () => {
  it("never contains the subject", async () => {
    const ref = await userRef("9449306621", store);
    expect(ref).toMatch(/^u_/);
    expect(ref).not.toContain("9449306621");
  });
  it("fails loudly without a key", async () => {
    await expect(userRef("subject", unconfigured)).rejects.toThrow(/not configured/);
  });
});

describe("matchSteps", () => {
  const funnels: Funnel[] = [
    {
      id: "book",
      description: "Book an appointment",
      steps: [
        { id: "start", path: "/book" },
        { id: "choose", path: /^\/book\/slots\/[\w-]+$/ },
        { id: "done", path: "/book/confirmed" },
      ],
    },
  ];
  it("finds exact and pattern steps with their position", () => {
    expect(matchSteps("/book", funnels)).toEqual([
      { funnel: "book", step: "start", stepIndex: 1, stepCount: 3 },
    ]);
    expect(matchSteps("/book/slots/abc-1", funnels)[0]).toMatchObject({ step: "choose", stepIndex: 2 });
  });
  it("ignores pages outside any funnel", () => {
    expect(matchSteps("/elsewhere", funnels)).toEqual([]);
  });
});

describe("journeys", () => {
  it("records nothing without a session", async () => {
    const { log, lines } = captureLogger();
    await recordJourneyStep(log, { path: "/", store });
    expect(lines).toEqual([]);
  });
  it("logs journey.step with a pseudonymous journey ID", async () => {
    const { log, lines } = captureLogger();
    await recordJourneyStep(log, { sessionId: "session-123", path: "/", store });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "journey.step", funnel: "home", step: "landing" });
    expect(lines[0].journeyId).toBe(await journeyIdFor("session-123", { store }));
    expect(JSON.stringify(lines[0])).not.toContain("session-123");
  });
  it("links a journey to a userRef", async () => {
    const { log, lines } = captureLogger();
    await linkJourney(log, { sessionId: "session-123", userRef: "u_abc", store });
    expect(lines[0]).toMatchObject({ event: "journey.linked", userRef: "u_abc" });
    expect(lines[0].journeyId).toMatch(/^j_/);
  });
  it("records nothing when the key is not configured", async () => {
    const { log, lines } = captureLogger();
    await recordJourneyStep(log, { sessionId: "s", path: "/", store: unconfigured });
    expect(lines).toEqual([]);
  });
});

describe("audit", () => {
  it("rejects badly formed action names", async () => {
    await expect(audit({ action: "Sign In", outcome: "success" }, {})).rejects.toThrow();
    await expect(audit({ action: "signin", outcome: "success" }, {})).rejects.toThrow();
  });
  it("accepts area.verb action names", async () => {
    await expect(
      audit({ action: "session.sign_in", outcome: "success", userRef: "u_x" }, { requestId: "r1" }),
    ).resolves.toBeUndefined();
  });
});
