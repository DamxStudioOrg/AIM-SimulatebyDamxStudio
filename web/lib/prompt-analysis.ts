/**
 * Prompt craft: a deterministic rubric over the steward prompt
 * itself — the moves strong prompts make, scored before the run
 * spends a token. Six structural checks (departments, numbers,
 * conditionals, reserves, shock readiness, output discipline)
 * plus, when the trial names hazards, whether the prompt answers
 * them. A scaffold, not a judge: keyword-stuffing can raise the
 * score without raising impact, so the console pairs it with the
 * player's own craft-vs-impact record (craftCorrelation) instead
 * of preaching it as truth.
 */

export type CraftState = "have" | "partial" | "missing";

export interface CraftItem {
  id: string;
  label: string;
  state: CraftState;
  detail: string;
}

export interface PromptAnalysis {
  /** Weighted 0–100 across the items present. */
  score: number;
  items: CraftItem[];
  /** Canonical departments the prompt names. */
  departmentsNamed: string[];
}

/** The sim's allocation keys, with the words players actually use. */
const DEPARTMENTS: Readonly<Record<string, readonly string[]>> = {
  housing: ["housing", "homes", "houses"],
  transit: ["transit", "buses", "bus", "transport"],
  health: ["health", "clinics", "clinic", "hospital"],
  green: ["green", "parks", "park", "trees", "tree"],
  reserves: ["reserves"],
  rescue: ["rescue", "evacuation", "evacuate"],
  shelter: ["shelter", "shelters"],
  repair: ["repair", "repairs", "infrastructure", "infra"],
};

const HAZARDS: readonly { id: string; words: readonly string[] }[] = [
  { id: "flood", words: ["flood", "water", "river", "rain"] },
  { id: "heat", words: ["heat", "heatwave", "cool", "shade"] },
  { id: "drought", words: ["drought", "water", "ration"] },
  { id: "quake", words: ["quake", "earthquake", "seismic"] },
  { id: "storm", words: ["storm", "wind", "hurricane"] },
  { id: "fire", words: ["fire", "wildfire", "smoke"] },
  { id: "blackout", words: ["blackout", "power", "grid"] },
  { id: "outbreak", words: ["outbreak", "disease", "epidemic", "clinic"] },
];

function mentions(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function item(
  id: string,
  label: string,
  fraction: number,
  haveDetail: string,
  missingDetail: string,
): { craft: CraftItem; fraction: number } {
  const state: CraftState =
    fraction >= 1 ? "have" : fraction > 0 ? "partial" : "missing";
  return {
    fraction,
    craft: {
      id,
      label,
      state,
      detail: state === "missing" ? missingDetail : haveDetail,
    },
  };
}

const WEIGHTS: Readonly<Record<string, number>> = {
  departments: 25,
  numbers: 20,
  conditionals: 20,
  reserves: 15,
  shocks: 10,
  discipline: 10,
  hazards: 15,
};

/** Hazards a trial names across its title, brief, and drivers. */
function challengeHazards(challenge: {
  title: string;
  brief: string;
  drivers: readonly string[];
}): string[] {
  const text = [challenge.title, challenge.brief, ...challenge.drivers].join(" ");
  return HAZARDS.filter((hazard) =>
    hazard.words.some((word) => mentions(text, word)),
  ).map((hazard) => hazard.id);
}

/**
 * Score one steward prompt. The challenge, when given, adds the
 * hazard-answer check for the hazards it names.
 */
export function analyzePrompt(
  prompt: string,
  challenge?: { title: string; brief: string; drivers: readonly string[] },
): PromptAnalysis {
  const text = prompt.trim();
  const lower = text.toLowerCase();
  const scored: { craft: CraftItem; fraction: number; weight: number }[] = [];
  const add = (entry: { craft: CraftItem; fraction: number }, weight: number): void => {
    scored.push({ ...entry, weight });
  };

  const departmentsNamed = Object.entries(DEPARTMENTS)
    .filter(([, words]) => words.some((word) => mentions(lower, word)))
    .map(([key]) => key);
  add(
    item(
      "departments",
      "Names the departments",
      Math.min(1, departmentsNamed.length / 6),
      `${String(departmentsNamed.length)} of 8 named — the model funds what the prompt names.`,
      "Name the departments to fund: housing, transit, health, green, reserves, rescue, shelter, repair.",
    ),
    WEIGHTS.departments ?? 0,
  );

  const percents = (text.match(/\d+(?:\.\d+)?\s*%/g) ?? []).length;
  const figures = (text.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length;
  add(
    item(
      "numbers",
      "Gives numbers",
      percents >= 2 ? 1 : percents === 1 || figures >= 3 ? 0.5 : 0,
      "Percentages pin the split — vague prompts get improvised allocations.",
      "Give the split in numbers: “housing 30%, health 25%…” beats “fund housing well”.",
    ),
    WEIGHTS.numbers ?? 0,
  );

  const conditionals = (
    text.match(/\b(if|when|once|unless|whenever|in case)\b/gi) ?? []
  ).length;
  add(
    item(
      "conditionals",
      "Plans contingencies",
      conditionals >= 2 ? 1 : conditionals / 2,
      "If/when rules turn shocks into decisions already made.",
      "Add if/when rules: “if a flood hits, shift 15% to rescue and shelter.”",
    ),
    WEIGHTS.conditionals ?? 0,
  );

  const reserveWords = [
    "reserve",
    "reserves",
    "floor",
    "keep at least",
    "hold back",
    "buffer",
    "emergency fund",
    "never below",
  ];
  const hasReserve = reserveWords.some((word) => lower.includes(word));
  add(
    item(
      "reserves",
      "Protects reserves",
      hasReserve ? 1 : 0,
      "A floor under reserves keeps the second shock survivable.",
      "Protect a floor: “keep reserves at 15% or more; never spend the last buffer.”",
    ),
    WEIGHTS.reserves ?? 0,
  );

  const shockWords = [
    "shock",
    "flood",
    "heatwave",
    "crisis",
    "turn 5",
    "turn 9",
    "pre-position",
    "before the",
    "emergency",
  ];
  const shockHits = shockWords.filter((word) => lower.includes(word)).length;
  add(
    item(
      "shocks",
      "Readies for shocks",
      shockHits >= 2 ? 1 : shockHits / 2,
      "Shocks land at turns 5 and 9 — prompts that name them pre-position.",
      "Name the shocks: pre-position rescue and shelter before turns 5 and 9.",
    ),
    WEIGHTS.shocks ?? 0,
  );

  const disciplineWords = [
    "json",
    "concise",
    "brief",
    "short",
    "only",
    "exactly",
    "no explanation",
    "format",
  ];
  const hasDiscipline = disciplineWords.some((word) => mentions(lower, word));
  add(
    item(
      "discipline",
      "Keeps replies tight",
      hasDiscipline ? 1 : 0,
      "Tight replies don't skip turns — every skipped turn scores zero.",
      "Ask for tight replies: skipped turns score zero, so demand the JSON first.",
    ),
    WEIGHTS.discipline ?? 0,
  );

  if (challenge !== undefined) {
    const hazards = challengeHazards(challenge);
    if (hazards.length > 0) {
      const answered = hazards.filter((hazard) => {
        const entry = HAZARDS.find((candidate) => candidate.id === hazard);
        return entry?.words.some((word) => mentions(lower, word)) ?? false;
      });
      add(
        item(
          "hazards",
          "Answers this trial's hazards",
          answered.length / hazards.length,
          `Names ${answered.join(", ")} — this trial's named hazards have a plan.`,
          `This trial names ${hazards.join(", ")} — the prompt never answers them.`,
        ),
        WEIGHTS.hazards ?? 0,
      );
    }
  }

  const totalWeight = scored.reduce((sum, entry) => sum + entry.weight, 0);
  const earned = scored.reduce((sum, entry) => sum + entry.weight * entry.fraction, 0);
  const score =
    text === "" || totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);
  return {
    score: text === "" ? 0 : score,
    items: scored.map((entry) => entry.craft),
    departmentsNamed,
  };
}

export interface CraftCorrelation {
  threshold: number;
  highAvg: number;
  lowAvg: number;
  highCount: number;
  lowCount: number;
  delta: number;
}

export interface CraftPoint {
  craft: number;
  impact: number;
}

/**
 * Scatter points for the craft-vs-impact graph: one per recorded
 * run with a saved prompt, newest first, capped so the figure
 * stays readable.
 */
export function craftScatterPoints(
  entries: readonly { prompt: string; impact: number }[],
  limit = 60,
): CraftPoint[] {
  const points: CraftPoint[] = [];
  for (const entry of entries) {
    if (entry.prompt.trim() === "") {
      continue;
    }
    points.push({ craft: analyzePrompt(entry.prompt).score, impact: entry.impact });
    if (points.length >= limit) {
      break;
    }
  }
  return points;
}

/**
 * The player's own evidence: average impact of runs whose prompt
 * scored at/above the craft bar vs below it. Null until both sides
 * have runs — small samples would preach noise.
 */
export function craftCorrelation(
  entries: readonly { prompt: string; impact: number }[],
  threshold = 60,
): CraftCorrelation | null {
  let highSum = 0;
  let highCount = 0;
  let lowSum = 0;
  let lowCount = 0;
  for (const entry of entries) {
    if (entry.prompt.trim() === "") {
      continue;
    }
    const { score } = analyzePrompt(entry.prompt);
    if (score >= threshold) {
      highSum += entry.impact;
      highCount += 1;
    } else {
      lowSum += entry.impact;
      lowCount += 1;
    }
  }
  if (highCount < 2 || lowCount < 2) {
    return null;
  }
  const highAvg = highSum / highCount;
  const lowAvg = lowSum / lowCount;
  return {
    threshold,
    highAvg: Math.round(highAvg * 10) / 10,
    lowAvg: Math.round(lowAvg * 10) / 10,
    highCount,
    lowCount,
    delta: Math.round((highAvg - lowAvg) * 10) / 10,
  };
}
