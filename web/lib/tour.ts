/**
 * Onboarding tour table + controls. React-free on purpose: the
 * layout mounts the overlay on every route (landing included), so
 * this module must stay importable without any simulation code
 * (see landing:check).
 *
 * One tour walks every signed-in page: steps carry their route,
 * and advancing across a page boundary navigates. First-run shows
 * start at the visitor's own page; the Account restart always
 * begins at the console.
 */

export interface TourStep {
  id: string;
  /** Route the step lives on; Next/Back navigate to reach it. */
  page: string;
  /** Short page label for the card header. */
  pageLabel: string;
  title: string;
  desc: string;
  /** Optional anchor scrolled into view when the step shows. */
  selector?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "pick",
    page: "/console",
    pageLabel: "Operator console",
    title: "Pick your trial",
    desc: "One simulation, alternating shifts: city crises and tote pack-outs. The console arms the trial you're given — fixed seed, limits, and goals. Cleared trials unlock the next.",
    selector: "#challenge",
  },
  {
    id: "prompt",
    page: "/console",
    pageLabel: "Operator console",
    title: "Write the steward prompt",
    desc: "Your prompt steers every turn. Word caps scale with the model — 150 on local runtimes, 300 hosted. The simulation appends the reply shape, so write strategy only.",
    selector: "#prompt",
  },
  {
    id: "model",
    page: "/console",
    pageLabel: "Operator console",
    title: "Choose who plays",
    desc: "A local runtime (Ollama, LM Studio) or a hosted model on your own key. Keys stay encrypted on this device — never on a host key.",
    selector: "#model",
  },
  {
    id: "run",
    page: "/console",
    pageLabel: "Operator console",
    title: "Run the simulation",
    desc: "Hit Run match and watch the left panel: the city replays each turn, the pack-out crane loads the tote. Verdicts land below with score breakdowns and loss reasons.",
    selector: "[data-tour='run-button']",
  },
  {
    id: "iterate",
    page: "/prompts",
    pageLabel: "Prompt history",
    title: "Iterate & ablate",
    desc: "Replay or edit any past run, or queue prompt variants across seeds in the batch ablation runner. Same seed plus same prompt replays the same simulation.",
    selector: "#ablation-prompts",
  },
  {
    id: "board",
    page: "/ranks",
    pageLabel: "Ranks & leagues",
    title: "One simulation, ranked",
    desc: "Both shifts share one board — pack scores ride the unified 0–100 scale beside city impact. Narrow to a single shift or challenge for the native table.",
    selector: "#arena-ranks-heading",
  },
  {
    id: "leagues",
    page: "/ranks",
    pageLabel: "Ranks & leagues",
    title: "Leagues, duels & shared trials",
    desc: "Copy a duel target, import AIM1. codes, run a league season, and simulate challenges other players created and shared with you.",
    selector: "#leagues-heading",
  },
  {
    id: "arena-id",
    page: "/account",
    pageLabel: "Your account",
    title: "Keep your arena ID",
    desc: "Your account is one random ID, stored only on this machine. Copy it somewhere safe — lose it and your progress cannot be recovered.",
    selector: ".recovery-card",
  },
  {
    id: "connect",
    page: "/account",
    pageLabel: "Your account",
    title: "Connect models",
    desc: "Add provider keys, check local runtimes, and grab app updates. Everything model-side runs on your own credentials.",
    selector: "#connect-models-heading",
  },
  {
    id: "docs",
    page: "/docs",
    pageLabel: "What it does",
    title: "Read the playbook",
    desc: "The docs explain every system in the simulation. That's the tour — the console is yours.",
  },
];

export const TOUR_SEEN_KEY = "simulate.tourSeen";
export const TOUR_START_EVENT = "simulate:tour-start";

/** First step index living on a route; 0 when the route has none. */
export function firstStepForPage(pathname: string): number {
  const index = TOUR_STEPS.findIndex((step) => step.page === pathname);
  return index < 0 ? 0 : index;
}

/** Restart the tour from the top, wherever the visitor stands. */
export function startTour(): void {
  window.dispatchEvent(new Event(TOUR_START_EVENT));
}

export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_SEEN_KEY, "1");
  } catch {
    // Blocked storage: the tour shows again next visit. Ephemeral
    // sessions can't persist dismissal; the modal still dismisses.
  }
}
