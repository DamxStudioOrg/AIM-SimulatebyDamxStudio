import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Landing from "../app/page";
import { AuthProvider } from "../app/auth-context";
import { MoonVisualProvider } from "../app/moon-visual";
import AnalyticsDashboard from "../app/analytics-dashboard";
import ChallengeAftermath, {
  type ChallengeAftermathProps,
} from "../app/challenge-aftermath";
import RecoveryCard from "../app/recovery-card";
import DatasetsPanel from "../app/datasets-panel";
import PromptVersionGraph from "../app/prompt-version-graph";
import PlanetPanel from "../app/planet-panel";
import ProgressStrip from "../app/progress-strip";
import ChallengesPanel from "../app/challenges-panel";
import DocsPanel from "../app/docs-panel";
import ShareRow from "../app/share-row";
import { LandingChallenge } from "../app/landing-challenge";
import ChallengePicker from "../app/challenge-picker";
import ProgressBoard from "../app/progress-board";
import AppUpdateCard from "../app/app-update-card";
import ChainStrip from "../app/chain-strip";
import PageHeader from "../app/page-header";
import SiteHeader from "../app/site-header";
import RunButton from "../app/run-button";
import DepartmentBrief from "../app/department-brief";
import { ChartShapeToggle } from "../components/application/dashboard/chart-shape-toggle";
import { RevenueChartCard } from "../components/application/dashboard/revenue-chart-card";
import { OrdersChartCard } from "../components/application/dashboard/orders-chart-card";
import { CHALLENGES, DRILLS, TOTE_CHALLENGES, endlessVariant } from "./challenges";
import type { HistoryEntry } from "./history";
import type { MatchResultPayload } from "./sim";
import type { useMatch } from "../app/use-match";

describe("PlanetPanel", () => {
  it("renders children inside the enabled boundary", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(
          PlanetPanel,
          { enabled: true },
          createElement("p", null, "inside"),
        ),
      ),
    );
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain("inside");
  });

  it("renders nothing at all when disabled", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(
          PlanetPanel,
          { enabled: false },
          createElement("p", null, "secret"),
        ),
      ),
    );
    expect(html).toContain('data-enabled="false"');
    expect(html).not.toContain("secret");
  });

  it("rides the bottom logo home while signed out", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(
          PlanetPanel,
          { enabled: true },
          createElement("p", null, "inside"),
        ),
      ),
    );
    // Static render starts signed out; the console target is pinned live.
    expect(html).toContain('aria-label="Back to home"');
  });
});

describe("SiteHeader", () => {
  it("shows the logo mark only, with no wordmark, buttons, or controls", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(MoonVisualProvider, null, createElement(SiteHeader)),
      ),
    );
    expect(html).toContain('src="/logo.png"');
    expect(html).toContain("brand-mark");
    expect(html).toContain('aria-label="Simulate by Damx Studio — home"');
    // Static render starts signed out, so the mark rides home here;
    // the signed-in console target is pinned in the smoke suite.
    expect(html).toContain('href="/"');
    expect(html).not.toContain("moon-placeholder");
    expect(html).not.toContain("header-moon");
    expect(html).not.toContain(">Simulate by Damx Studio<");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Sign out");
    expect(html).not.toContain("Download app");
    expect(html).not.toContain("Simulation");
    expect(html).not.toContain("Controls");
    expect(html).not.toContain("<button");
  });
});

describe("Landing", () => {
  it("shows the slideshow and desktop downloads with no simulation surface", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(MoonVisualProvider, null, createElement(Landing)),
      ),
    );
    expect(html).toContain('ph-pill ph-a">Simulate<');
    expect(html).toContain('ph-pill ph-b">by Damx Studio<');
    expect(html).toContain("of 3:");
    expect(html).toContain("Download for macOS");
    expect(html).toContain("Download for Windows");
    expect(html).toContain("Download for Linux");
    expect(html).toContain('src="/logo.png"');
    expect(html).not.toContain(">Home<");
    expect(html).not.toContain("<canvas");
  });

  it("teases the docs with a link instead of inlining them", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(MoonVisualProvider, null, createElement(Landing)),
      ),
    );
    expect(html).toContain('href="/docs"');
    expect(html).toContain("Read the docs");
    expect(html).not.toContain("Propose trials");
  });
});

describe("PageHeader", () => {
  it("renders two pills with readable spacing", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { words: ["Operator", "console"] }),
    );
    expect(html).toContain("<h1");
    expect(html).toContain('ph-pill ph-a">Operator<');
    expect(html).toContain('ph-pill ph-b">console<');
    expect(html).not.toContain("ph-mark");
    expect(html).not.toContain("ph-row-2");
    // Real spaces between the spans keep the plain title readable.
    expect(html).toContain("</span> <span");
  });

  it("renders the green third pill on its own overlapping row", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { words: ["Ranks", "stats", "leagues"] }),
    );
    expect(html).toContain("ph-row-2");
    expect(html).toContain('ph-pill ph-c">leagues<');
  });

  it("passes id and highlight marker through to the h1", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        id: "guide-heading",
        highlightTitle: true,
        words: ["Field", "guide"],
      }),
    );
    expect(html).toContain('id="guide-heading"');
    expect(html).toContain('data-highlight-title="true"');
  });

  it("omits the highlight marker by default", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { words: ["Your", "account"] }),
    );
    expect(html).not.toContain("data-highlight-title");
  });
});

describe("ProgressBoard", () => {
  const win = {
    when: "2026-11-03T00:00:00.000Z",
    impact: 60.12,
    efficiency: 35.97,
    model: "ollama/hermes3:8b",
  };

  it("lists cleared trials only, with no numbering", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressBoard, {
        completions: { debut: win, "market-day": { ...win, impact: 45 } },
        runCount: 1,
      }),
    );
    expect(html).toContain("Your progress");
    expect(html).toContain("1 trial cleared · 1 tote packed");
    expect(html).toContain("First whistle");
    expect(html).toContain("Market day tote");
    expect(html).toContain("Impact 60.12");
    expect(html).toContain("Score 45.0");
    expect(html).not.toContain('board-name" title="Hold the west wall"');
    expect(html).not.toContain("1. First whistle");
    expect(html).toContain("Next up:");
  });

  it("alternates city and tote in unified order", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressBoard, {
        completions: { debut: win, "market-day": win },
        runCount: 2,
      }),
    );
    const city = html.indexOf("First whistle");
    const tote = html.indexOf("Market day tote");
    expect(city).toBeGreaterThan(-1);
    expect(tote).toBeGreaterThan(city);
  });

  it("shows an empty state with the next trial", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressBoard, { completions: {}, runCount: 0 }),
    );
    expect(html).toContain("0 trials cleared");
    expect(html).toContain("No cleared trials yet");
    expect(html).toContain("Next up:");
    expect(html).toContain("First whistle");
    expect(html).not.toContain("<li");
  });
});

describe("ChallengePicker", () => {
  const first = CHALLENGES[0];
  const firstTote = TOTE_CHALLENGES[0];
  if (first === undefined || firstTote === undefined) {
    throw new Error("expected ranked challenges");
  }
  const win = {
    when: "2026-11-03T00:00:00.000Z",
    impact: 60,
    efficiency: 30,
    model: "m",
  };

  it("offers unlocked trials only, never open play", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePicker, {
        value: first.id,
        unlocked: [first],
        completions: {},
        onPick: () => undefined,
      }),
    );
    expect(html).toContain("City · First whistle");
    expect(html).not.toContain("Open prompt");
    expect(html).not.toContain("Open tote");
    expect(html).not.toContain("open-tote");
  });

  it("waits disabled while unlocks load", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePicker, {
        value: "",
        unlocked: [],
        completions: {},
        onPick: () => undefined,
      }),
    );
    expect(html).toContain("Loading your trial…");
    expect(html).toContain("disabled");
  });

  it("marks cleared trials and tote kinds", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePicker, {
        value: firstTote.id,
        unlocked: [firstTote],
        completions: { [firstTote.id]: win },
        onPick: () => undefined,
      }),
    );
    expect(html).toContain("✓ Tote · Market day tote");
  });

  it("lists prompting drills under their own always-open group", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengePicker, {
        value: "drill-fix",
        unlocked: [first],
        completions: {},
        onPick: () => undefined,
        drills: DRILLS,
      }),
    );
    expect(html).toContain("Prompting drills — practice, no rank");
    expect(html).toContain("always open, practice only");
    expect(html).toContain("City · Fix the leak");
    expect(html).toContain("City · Eighty words");
  });
});

describe("LandingChallenge", () => {
  it("dares the reader in two beats plus a download pointer", () => {
    const html = renderToStaticMarkup(createElement(LandingChallenge));
    expect(html).toContain("Everyone claims they can prompt.");
    expect(html).toContain("Prove it.");
    expect(html).toContain("Download the app and get scored.");
  });
});

describe("ShareRow", () => {
  it("links every major platform plus a copy button", () => {
    const html = renderToStaticMarkup(createElement(ShareRow));
    expect(html).toContain("Challenge a friend:");
    const targets: [string, string][] = [
      ["Share on X", "x.com/intent/tweet"],
      ["Share on Facebook", "facebook.com/sharer/sharer.php"],
      ["Share on WhatsApp", "wa.me/"],
      ["Share on Telegram", "t.me/share/url"],
      ["Share on LinkedIn", "linkedin.com/sharing/share-offsite"],
      ["Share on Reddit", "reddit.com/submit"],
    ];
    for (const [label, domain] of targets) {
      expect(html).toContain(`aria-label="${label}"`);
      expect(html).toContain(domain);
    }
    expect(html).not.toContain("twitter.com");
    // Instagram has no share URL: an icon-matching button copies instead.
    expect(html).toContain('aria-label="Copy for Instagram"');
    // Every share points at the canonical download site.
    expect(html).toContain("simulate.damxstudio.com");
    expect(html).toContain("Copy");
  });
});

describe("DocsPanel", () => {
  it("lists all nine actionable sections with steps", () => {
    const html = renderToStaticMarkup(createElement(DocsPanel));
    for (const title of [
      "First run, end to end",
      "Connect a model",
      "Climb the chain",
      "Prompt like a steward",
      "Prepare the land (field plan)",
      "Create and dress a challenge",
      "Ranks, leagues, and shared trials",
      "Your account and arena ID",
      "When something looks wrong",
    ]) {
      expect(html).toContain(title);
    }
    // Guidance is steps, not blurbs: the arena-ID key warning and the
    // LM Studio auto-connect move both ship as actionable lines.
    expect(html).toContain("Treat it like a key");
    expect(html).toContain("both stock LM Studio ports are probed");
  });
});

describe("ChallengesPanel", () => {
  const win = {
    when: "2026-11-03T00:00:00.000Z",
    impact: 60.12,
    efficiency: 35.97,
    model: "demo",
  };

  it("graphs cleared trials with bests and a next-trial CTA", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengesPanel, {
        completions: { debut: win, "market-day": { ...win, impact: 45 } },
        onPlay: () => undefined,
      }),
    );
    expect(html).toContain("Your challenges");
    expect(html).toContain("1 trial cleared · 1 tote packed");
    expect(html).toContain("Best impact 60.12");
    expect(html).toContain("Best efficiency 35.97");
    expect(html).toContain("First whistle");
    expect(html).toContain("Market day tote");
    expect(html).toContain("cp-bar-city");
    expect(html).toContain("cp-bar-tote");
    expect(html).toContain("Play next —");
    // No fixed total anywhere on the panel.
    expect(html).not.toContain("/18");
  });

  it("shows an empty state with the first trial CTA", () => {
    const html = renderToStaticMarkup(
      createElement(ChallengesPanel, {
        completions: {},
        onPlay: () => undefined,
      }),
    );
    expect(html).toContain("0 trials cleared");
    expect(html).toContain("No cleared trials yet");
    expect(html).toContain("Play next — First whistle");
    expect(html).not.toContain("<rect");
  });
});

describe("ProgressStrip", () => {
  it("shows the active challenge and its run action", () => {
    const challenge = CHALLENGES[0];
    if (challenge === undefined) throw new Error("expected a first challenge");
    const match = {
      completions: {},
      activeChallenge: challenge,
      unlocked: [challenge],
      result: null,
      boardPosition: null,
      running: false,
      pickChallenge: () => undefined,
      runMatch: () => Promise.resolve(),
    } as unknown as ReturnType<typeof useMatch>;
    const html = renderToStaticMarkup(
      createElement(ProgressStrip, {
        match,
        canPlay: true,
        signedIn: true,
        onEditPrompt: () => undefined,
      }),
    );
    expect(html).toContain(challenge.title);
    expect(html).toContain("Run challenge");
    expect(html).toContain("Edit prompt");
  });
});

describe("DatasetsPanel", () => {
  it("renders nothing without the desktop bridge", () => {
    const html = renderToStaticMarkup(createElement(DatasetsPanel, { uid: "test" }));
    expect(html).not.toContain("Dataset sandbox");
    expect(html).not.toContain("Select dataset folder");
  });
});

describe("ScrollHighlightScope", () => {
  it("wraps the landing writeup and marks highlight blocks", () => {
    const html = renderToStaticMarkup(
      createElement(
        AuthProvider,
        null,
        createElement(MoonVisualProvider, null, createElement(Landing)),
      ),
    );
    expect(html).toContain("highlight-scope");
    expect(html).toContain("data-highlight");
    expect(html).toContain("data-highlight-title");
  });
});

describe("ChartShapeToggle", () => {
  it("presses the active shape only", () => {
    const html = renderToStaticMarkup(
      createElement(ChartShapeToggle, { shape: "bars", onChange: () => undefined }),
    );
    expect(html).toContain('aria-label="Chart shape"');
    expect(html).toContain("Area");
    expect(html).toContain("Bars");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("shape-active");
  });
});

describe("DashboardTheme", () => {
  const result: MatchResultPayload = {
    seed: 7,
    provider: "theme-probe",
    scores: { impact: 0.9, efficiency: 0.6 },
    totals: { tokens_used: 12000, spend: 1500 },
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 0,
      skipped_turns: 0,
    },
    prompt_words: 40,
    token_budget: 50000,
  };

  it("dashboard renders in the dark site scope", () => {
    const html = renderToStaticMarkup(
      createElement(AnalyticsDashboard, { results: [result] }),
    );
    expect(html).toContain('class="analytics-dashboard dark"');
    expect(html).toContain("Model comparison");
  });

  it("stat cards stay two-up with truncating deltas in narrow hosts", () => {
    const html = renderToStaticMarkup(
      createElement(AnalyticsDashboard, { results: [result] }),
    );
    // Viewport breakpoints must not widen the moon-slot grid to four.
    expect(html).toContain("grid-cols-2");
    expect(html).not.toContain("lg:grid-cols-4");
    // Long provider ids truncate inside the chip; hover reveals all.
    expect(html).toContain("truncate");
    expect(html).toContain('title="theme-probe"');
  });

  it("version graph renders in the dark site scope", () => {
    const entry: HistoryEntry = {
      when: "2026-11-02T15:00:00.000Z",
      seed: 7,
      provider: "theme-probe",
      prompt: "probe",
      impact: 0.9,
      efficiency: 0.6,
      result,
    };
    const html = renderToStaticMarkup(
      createElement(PromptVersionGraph, { entries: [entry] }),
    );
    expect(html).toContain('class="prompt-version-graph dark"');
    expect(html).toContain("Impact by version");
  });
});

describe("ChallengeAftermath", () => {
  const first = CHALLENGES[0];
  const second = CHALLENGES[1];
  const firstTote = TOTE_CHALLENGES[0];
  if (first === undefined || second === undefined || firstTote === undefined) {
    throw new Error("expected ranked challenges");
  }
  const result: MatchResultPayload = {
    seed: 1,
    provider: "aftermath-probe",
    scores: { impact: 60.0, efficiency: 12.0 },
    totals: { tokens_used: 3000, spend: 900000 },
    loss_reasons: [],
    turns: [],
    badges: [],
    strategy: {
      mean_allocation: {},
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
    prompt_words: 40,
    token_budget: 15000,
  };
  const render = (overrides: Partial<ChallengeAftermathProps> = {}) =>
    renderToStaticMarkup(
      createElement(ChallengeAftermath, {
        challenge: first,
        result,
        checks: [{ label: "Finish the match", passed: true, actual: "60.00" }],
        cleared: true,
        best: undefined,
        completions: {},
        onRetryPrompt: () => undefined,
        onRetryModel: () => undefined,
        onGoTo: () => undefined,
        boardPosition: null,
        showFull: false,
        onToggleFull: () => undefined,
        ...overrides,
      }),
    );

  it("offers retry, next, and endless on a cleared trial", () => {
    const html = render({
      completions: { [first.id]: { when: "", impact: 60, efficiency: 12, model: "m" } },
    });
    expect(html).toContain("trial cleared");
    expect(html).toContain(first.story[first.story.length - 1] ?? "");
    expect(html).toContain("Retry with a new prompt");
    expect(html).toContain("Retry with another model");
    expect(html).toContain(`Next challenge — ${firstTote.title}`);
    expect(html).toContain("Endless replay — cycle 1");
    expect(html).toContain("Show full data analysis");
    expect(html).toContain("60.00");
  });

  it("names the thinking share of the token bill", () => {
    const html = render({
      result: {
        ...result,
        totals: { tokens_used: 7626, spend: 900000, thinking_tokens: 3102 },
      },
    });
    expect(html).toContain("7,626 (+3,102 thinking)");
    const plain = render();
    expect(plain).toContain("3,000");
    expect(plain).not.toContain("thinking");
  });

  it("locks onward steps behind a missed trial", () => {
    const html = render({
      challenge: second,
      cleared: false,
      checks: [{ label: "Impact ≥ 56", passed: false, actual: "40.00" }],
    });
    expect(html).toContain("trial missed");
    expect(html).toContain("Retry with a new prompt");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Endless replay");
  });

  it("chains endless cycles instead of chain steps on variants", () => {
    const variant = endlessVariant(first, 2);
    const html = render({
      challenge: variant,
      completions: {
        [first.id]: { when: "", impact: 60, efficiency: 12, model: "m" },
        [variant.id]: { when: "", impact: 61, efficiency: 12, model: "m" },
      },
    });
    expect(html).toContain(`Next cycle — ${first.title} 3`);
    expect(html).not.toContain("Next challenge");
  });

  it("keeps the full dashboard out of the verdict (it plays left)", () => {
    const html = render({ showFull: true });
    expect(html).toContain("Hide full data analysis");
    expect(html).toContain('data-visual="aftermath"');
    expect(html).not.toContain("analytics-dashboard");
  });

  it("compares variety runs with a best-run callout", () => {
    const variant = (label: string, impact: number) => ({
      label,
      result: {
        ...result,
        scores: { impact, efficiency: 11.5 },
      },
    });
    const html = render({
      variants: [variant("Seed 7", 40), variant("Seed 8", 61.5), variant("Seed 9", 55)],
    });
    expect(html).toContain("Same prompt, three worlds");
    expect(html).toContain("Seed 7");
    expect(html).toContain("Seed 8");
    expect(html).toContain("Seed 9");
    expect(html).toContain("★ Seed 8 — impact 61.50, efficiency 11.50 — best run");
  });

  it("hides the strip on single runs", () => {
    expect(render({})).not.toContain("Same prompt, three worlds");
    expect(render({ variants: null })).not.toContain("Same prompt, three worlds");
  });

  it("coaches an empty log as a clean run and posts the board slot", () => {
    const html = render({ boardPosition: 7 });
    expect(html).toContain("Do differently next time");
    expect(html).toContain("Clean run — no drops, skips, or idle turns.");
    expect(html).toContain("Posted #7");
    expect(html).toContain('href="/ranks"');
  });

  it("hides the board line until the post lands", () => {
    expect(render({})).not.toContain("Posted #");
  });
});

describe("ChainStrip", () => {
  it("counts cleared trials and names the next one with its kind", () => {
    const first = CHALLENGES[0];
    if (first === undefined) {
      throw new Error("expected a first challenge");
    }
    const html = renderToStaticMarkup(
      createElement(ChainStrip, {
        completions: {
          [first.id]: { when: "", impact: 60, efficiency: 12, model: "m" },
        },
        onGoTo: () => undefined,
      }),
    );
    expect(html).toContain("1 cleared");
    expect(html).toContain("next:");
    expect(html).toContain("Play it");
  });

  it("starts the chain from empty", () => {
    const html = renderToStaticMarkup(
      createElement(ChainStrip, { completions: {}, onGoTo: () => undefined }),
    );
    expect(html).toContain("0 cleared");
  });
});

describe("AppUpdateCard", () => {
  it("offers a manual check without claiming a version", () => {
    const html = renderToStaticMarkup(createElement(AppUpdateCard));
    expect(html).toContain("App updates");
    expect(html).toContain("Check for updates");
    // Static render runs no effects: no version, no fabricated status.
    expect(html).toContain("cannot report its version");
    expect(html).not.toContain("up to date");
  });
});

describe("RecoveryCard", () => {
  it("shows the ID with a copy action and the loss warning", () => {
    const html = renderToStaticMarkup(
      createElement(RecoveryCard, {
        uid: "123e4567-e89b-12d3-a456-426614174000",
      }),
    );
    expect(html).toContain("Keep your arena ID");
    // Masked until revealed: dots and a Reveal button, never the ID.
    expect(html).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(html).toContain("••••••••");
    expect(html).toContain("Reveal");
    expect(html).toContain("lose the ID");
  });
});

describe("RunButton", () => {
  it("shows the idle label enabled", () => {
    const html = renderToStaticMarkup(
      createElement(RunButton, {
        running: false,
        startedAt: null,
        idleLabel: "Pack tote",
        busyLabel: "Packing",
        disabled: false,
        onRun: () => undefined,
      }),
    );
    expect(html).toContain("Pack tote");
    expect(html).not.toContain("run-spin");
    expect(html).not.toContain("disabled=");
  });

  it("reports busy status with elapsed seconds and a spinner", () => {
    const html = renderToStaticMarkup(
      createElement(RunButton, {
        running: true,
        startedAt: Date.now(),
        idleLabel: "Run match",
        busyLabel: "Turn 4 of 12",
        disabled: false,
        onRun: () => undefined,
      }),
    );
    expect(html).toMatch(/Turn 4 of 12 · \d+s/);
    expect(html).toContain("run-spin");
    expect(html).toContain('role="status"');
    expect(html).toContain("disabled=");
  });
});

describe("DepartmentBrief", () => {
  it("lists all eight departments with amounts and the 12-turn map", () => {
    const html = renderToStaticMarkup(createElement(DepartmentBrief));
    for (const label of [
      "Housing",
      "Transit",
      "Health",
      "Green",
      "Reserves",
      "Rescue",
      "Shelter",
      "Repair",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("≈54 lives");
    expect(html).toContain("≈$122k quarterly income");
    // One turn-map row per turn, shock turns marked.
    expect(html.match(/turn-map-turn/g)).toHaveLength(12);
    expect(html).toContain("T5");
    expect(html).toContain("T9");
    expect(html).toContain("shock");
  });
});

describe("ChartCards", () => {
  it("revenue card defaults to the area shape with a toggle", () => {
    const html = renderToStaticMarkup(createElement(RevenueChartCard));
    expect(html).toContain('data-shape="area"');
    expect(html).toContain("morph-chart");
    expect(html).toContain('aria-label="Chart shape"');
  });

  it("orders card defaults to the bars shape with a toggle", () => {
    const html = renderToStaticMarkup(createElement(OrdersChartCard));
    expect(html).toContain('data-shape="bars"');
    expect(html).toContain("morph-chart");
    expect(html).toContain('aria-label="Chart shape"');
  });
});
