/**
 * Funnels: the ordered pages of a journey we want to measure, such as the
 * steps of booking an appointment. When a signed-in user renders a page that
 * is a step of a funnel, the layout logs `journey.step` (lib/journey.ts), and
 * the `helloworld/dev/funnel` Logs Insights query counts journeys per step.
 *
 * To add a funnel, list its steps in order. `path` is matched against the
 * request path exactly, or tested when it is a regular expression.
 */

export type FunnelStep = { id: string; path: string | RegExp };
export type Funnel = { id: string; description: string; steps: FunnelStep[] };

export const FUNNELS: Funnel[] = [
  {
    id: "home",
    description: "Lands on the home page. Replace with real journeys as pages are added.",
    steps: [{ id: "landing", path: "/" }],
  },
];

export type StepMatch = { funnel: string; step: string; stepIndex: number; stepCount: number };

/** Every funnel step the path belongs to. */
export function matchSteps(path: string, funnels: Funnel[] = FUNNELS): StepMatch[] {
  const matches: StepMatch[] = [];
  for (const funnel of funnels) {
    funnel.steps.forEach((step, index) => {
      const hit = typeof step.path === "string" ? step.path === path : step.path.test(path);
      if (hit) {
        matches.push({
          funnel: funnel.id,
          step: step.id,
          stepIndex: index + 1,
          stepCount: funnel.steps.length,
        });
      }
    });
  }
  return matches;
}
