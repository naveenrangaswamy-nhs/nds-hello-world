import type { Logger } from "pino";
import { matchSteps, type Funnel } from "./funnels";
import { pseudonym } from "./pseudonym";
import { secrets, type SecretStore } from "./secrets";

/**
 * Cookieless journey tracking.
 *
 * A journey ID is a keyed hash of the signed-in session's ID, so all pages in
 * one session share it without any cookie, local storage or fingerprinting.
 * Before sign-in there is no session and nothing is recorded per person:
 * those pages count only as aggregate page views (`http.request`).
 *
 * - `journey.step`: a signed-in page view that is a step of a funnel.
 * - `journey.linked`: written once at sign-in, tying the journey to the
 *   person's pseudonymous `userRef`, so journeys can be joined to the audit
 *   trail without either log holding who the person is.
 */

type Options = { store?: SecretStore };

/** The journey ID for a session, or undefined when the key is not configured. */
export async function journeyIdFor(sessionId: string, { store = secrets }: Options = {}) {
  const key = await store.current("JOURNEY_HMAC_KEY");
  return key ? pseudonym("j", sessionId, key) : undefined;
}

/** Logs `journey.step` for each funnel step the page belongs to. */
export async function recordJourneyStep(
  log: Logger,
  { sessionId, path, funnels, store }: Options & { sessionId?: string; path?: string; funnels?: Funnel[] },
): Promise<void> {
  if (!sessionId || !path) return;
  const steps = matchSteps(path, funnels);
  if (steps.length === 0) return;
  const journeyId = await journeyIdFor(sessionId, { store });
  if (!journeyId) return;
  for (const step of steps) log.info({ event: "journey.step", journeyId, ...step });
}

/** Logs `journey.linked` when a session signs in. */
export async function linkJourney(
  log: Logger,
  { sessionId, userRef, store }: Options & { sessionId: string; userRef: string },
): Promise<void> {
  const journeyId = await journeyIdFor(sessionId, { store });
  if (!journeyId) return;
  log.info({ event: "journey.linked", journeyId, userRef });
}
