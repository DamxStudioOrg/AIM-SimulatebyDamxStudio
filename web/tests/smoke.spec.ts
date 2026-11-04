import { test, expect } from "@playwright/test";

test("landing shows slideshow and downloads", async ({ page }) => {
  await page.route("**/api/app-version", (route) =>
    route.fulfill({
      json: {
        version: "0.2.0",
        url: "https://releases.test/latest",
        notes: "",
        downloads: {
          mac: "https://board.test/downloads/simulate-macos.dmg",
          windows: "https://board.test/downloads/simulate-windows.exe",
          linux: "https://board.test/downloads/simulate-linux.AppImage",
        },
      },
    }),
  );
  await page.goto("/");
  await expect(page.locator("text=Simulate by Damx Studio")).toBeVisible();
  await expect(page.getByLabel("Download for macOS")).toBeVisible();
  await expect(page.getByLabel("Next slide")).toBeVisible();
  // The three download CTAs breathe a staggered brand glow so the
  // eye finds them; reduced motion keeps them still.
  const glow = await page.locator(".download-btn").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, delay: cs.animationDelay };
    }),
  );
  expect(glow).toEqual([
    { name: "download-glow", delay: "0s" },
    { name: "download-glow", delay: "0.35s" },
    { name: "download-glow", delay: "0.7s" },
  ]);
  // Each button calls its platform file from the version endpoint —
  // the map is the only wiring; no per-release landing edit.
  await expect(page.getByLabel("Download for macOS")).toHaveAttribute(
    "href",
    "https://board.test/downloads/simulate-macos.dmg",
  );
  await expect(page.getByLabel("Download for Windows")).toHaveAttribute(
    "href",
    "https://board.test/downloads/simulate-windows.exe",
  );
  await expect(page.getByLabel("Download for Linux")).toHaveAttribute(
    "href",
    "https://board.test/downloads/simulate-linux.AppImage",
  );
});

test("backdrop still paints when WebGL is unavailable", async ({ page }) => {
  await withoutTour(page);
  // The desktop app once showed a flat void: with no WebGL and no
  // WebGPU, Pixi's canvas renderer or the static fallback must still
  // paint the backdrop — never a blank canvas.
  await page.addInitScript(() => {
    const raw = HTMLCanvasElement.prototype.getContext as (
      this: HTMLCanvasElement,
      type: string,
    ) => RenderingContext | null;
    function patched(this: HTMLCanvasElement, type: string) {
      if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") {
        return null;
      }
      return raw.call(this, "2d");
    }
    HTMLCanvasElement.prototype.getContext =
      patched as unknown as typeof HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(navigator, "gpu", { value: undefined });
  });
  await page.goto("/");
  const canvas = page.locator("canvas.site-bg");
  await expect(canvas).toHaveAttribute("data-backdrop", /^(pixi|static)$/);
  const lit = await page.evaluate(() => {
    const el = document.querySelector("canvas.site-bg");
    if (!(el instanceof HTMLCanvasElement)) return 0;
    const ctx = el.getContext("2d");
    if (ctx === null) return 0;
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    let litPixels = 0;
    for (let i = 0; i < data.length; i += 400) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (r > 40 || g > 40 || b > 40) litPixels += 1;
    }
    return litPixels;
  });
  expect(lit).toBeGreaterThan(50);
});

test("no rim ring canvas anywhere", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("canvas.site-bg")).toHaveCount(1);
  // The planet outer ring is gone: one backdrop canvas only, no rim
  // overlay on any route.
  await expect(page.locator("canvas.site-rim")).toHaveCount(0);
  await page.goto("/console");
  await expect(page.locator("canvas.site-rim")).toHaveCount(0);
});

/**
 * Quiet first-run helper: the onboarding tour arms for every signed-in
 * first load, and its modal would intercept the clicks below. Tests
 * that are not about the tour pre-mark it seen; the tour test covers
 * the modal itself.
 */
async function withoutTour(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("simulate.tourSeen", "1");
    window.localStorage.setItem("aim-console-mode", "play");
  });
}

test("fresh console auto-logs-in without a click", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
  await expect(page.locator("text=This browser's matches")).toBeVisible();
  await expect(page.locator(".signin-card")).toHaveCount(0);
  // Default view: the looping demo simulation plays left before the
  // first run — the panel is never empty while signed in.
  await expect(page.locator(".moon-stage-slot figure.stage3d")).toBeVisible();
});

test("header shows brand mark; datasets gated to desktop; no console sign-out", async ({
  page,
}) => {
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator(".site-header .brand-mark")).toBeVisible();
  await expect(page.locator(".moon-placeholder")).toHaveCount(0);
  await expect(
    page.locator("section.recovery").getByRole("button", { name: "Sign out" }),
  ).toHaveCount(0);
  // Plain web has no preload bridge, so the sandbox section stays out.
  await expect(page.locator("section.datasets")).toHaveCount(0);
});

test("progress counts agree between console and ranks, with no fixed total", async ({
  page,
}) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aim-arena-challenges",
      JSON.stringify({
        debut: { when: "2026-11-01", impact: 50, efficiency: 12, model: "demo" },
        "flood-wall": {
          when: "2026-11-01",
          impact: 57,
          efficiency: 13,
          model: "demo",
        },
        "flood-wall~endless1": {
          when: "2026-11-02",
          impact: 58,
          efficiency: 13,
          model: "demo",
        },
        "market-day": {
          when: "2026-11-02",
          impact: 45,
          efficiency: 0,
          model: "demo",
        },
      }),
    );
  });
  // The console reads the sealed store (legacy plaintext migrates on
  // load): two trials plus one endless cycle plus one tote pack, no
  // denominator.
  await page.goto("/console");
  await expect(page.locator(".moon-stats")).toContainText("Challenges cleared4", {
    timeout: 10000,
  });
  await expect(page.locator(".moon-stats")).not.toContainText("/");
  // Ranks reads the same sealed source and splits the count.
  await page.goto("/ranks");
  await expect(page.locator(".board-title")).toHaveText(
    "2 trials cleared · 1 endless cycle · 1 tote packed",
    { timeout: 10000 },
  );
});

test("blocked storage still signs in for the session, honestly", async ({ page }) => {
  // The desktop app once shipped a dead Create button: with storage
  // throwing, the write failed AND the re-read landed back on
  // signed-out. Sessions must work in memory and say so.
  await page.addInitScript(() => {
    for (const key of ["getItem", "setItem", "removeItem"] as const) {
      Storage.prototype[key] = () => {
        throw new Error("storage blocked");
      };
    }
  });
  await page.goto("/console");
  // Seen-flags can't persist, so the tour always shows: wait for it
  // (it lands an effect after hydration) and dismiss it — its own
  // handlers must survive blocked storage too.
  const tour = page.getByRole("dialog", { name: "Onboarding tour" });
  await expect(tour).toBeVisible({ timeout: 10000 });
  await tour.getByRole("button", { name: "Skip" }).click();
  await expect(tour).toBeHidden();
  await expect(page.locator("text=Run match")).toBeVisible();
  await expect(page.locator("text=Storage is blocked here")).toBeVisible();
  // Sign-out lives on Account; the console keeps only the notice.
  // The tour re-arms on every page (its seen-flag can't persist),
  // so dismiss it again before clicking through.
  await page.goto("/account");
  await expect(tour).toBeVisible({ timeout: 10000 });
  await tour.getByRole("button", { name: "Skip" }).click();
  await expect(tour).toBeHidden();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".signin-card")).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Reveal" })).toBeVisible();
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
});

test("previous users sign in with an existing arena ID", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/account");
  await page.getByRole("button", { name: "Reveal" }).click();
  const uid = await page.locator(".recovery-card code").textContent();
  expect(uid).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  await page.getByRole("button", { name: "Hide" }).click();
  await expect(page.locator(".recovery-card code")).toHaveText("••••••••");
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".signin-card")).toBeVisible();
  await page.getByText("Already have an arena ID?").click();
  await page.locator(".adopt-id input").fill(uid ?? "");
  await page.getByRole("button", { name: "Sign in with this ID" }).click();
  await page.getByRole("button", { name: "Reveal" }).click();
  await expect(page.locator(".recovery-card code")).toHaveText(uid ?? "");
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
});

test("signing out shows the gate, and it stays after reload", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("text=Sign in to run")).toBeVisible();
  await page.goto("/console");
  await expect(page.locator("text=Sign in to run")).toBeVisible();
  await expect(page.locator("text=Run match")).toHaveCount(0);
});

/**
 * Readability guard: `toBeVisible` passes for transparent black-on-black
 * text, so the gate regressed while e2e stayed green. Read the real
 * computed styles instead: the card must paint an opaque surface and
 * its heading must stand far apart from it in lightness.
 */
async function cardReadability(
  page: import("@playwright/test").Page,
  cardSelector: string,
  textSelector: string,
): Promise<{ alpha: number; lightnessGap: number }> {
  return page.evaluate(
    ({ cardSelector, textSelector }) => {
      const card = document.querySelector(cardSelector);
      const text = document.querySelector(textSelector);
      if (!card || !text) return { alpha: 0, lightnessGap: 0 };
      const bg = getComputedStyle(card).backgroundColor;
      const fg = getComputedStyle(text).color;
      // alpha from rgb()/rgba()/lab() color strings
      const alphaMatch = /\/\s*([\d.]+)\s*\)/.exec(bg) ?? /,([\d.]+)\)/.exec(bg);
      const alpha = alphaMatch ? Number(alphaMatch[1]) : bg.startsWith("rgba") ? 0 : 1;
      const lightness = (color: string): number => {
        const lab = /lab\(\s*([\d.]+)/.exec(color);
        if (lab) return Number(lab[1]);
        const rgb = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
        const r = rgb[0] ?? 0;
        const g = rgb[1] ?? 0;
        const b = rgb[2] ?? 0;
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 2.55;
      };
      return {
        alpha,
        lightnessGap: Math.abs(lightness(fg) - lightness(bg)),
      };
    },
    { cardSelector, textSelector },
  );
}

test("console gate text contrasts on the opaque controls panel", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/console");
  // Fresh visits auto-login, so the gate only shows after sign-out
  // (from the Account page, the console's only way out).
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/console");
  await expect(page.locator(".signin-card")).toBeVisible();
  // The gate sits frameless on the controls panel (no nested card), so
  // the PANEL surface is what its text must contrast against.
  const { alpha, lightnessGap } = await cardReadability(
    page,
    ".planet-panel",
    ".signin-card h2",
  );
  expect(alpha).toBe(1);
  expect(lightnessGap).toBeGreaterThan(40);
});

test("account loop: auto-login, sign out, create again", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator(".shell-main")).toBeVisible();
  // Sign-out lives on Account (it shipped on no route once, and users
  // got stuck) — the console links there instead of signing out.
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".signin-card")).toBeVisible();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.locator(".shell-main")).toBeVisible();
});

test("desktop shows 30/70 square panels side by side, never overlapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
  const boxes = await page.evaluate(() => {
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const radius = getComputedStyle(el).borderTopLeftRadius;
      return { x: b.x, y: b.y, w: b.width, h: b.height, radius };
    };
    return {
      visual: r(document.querySelector(".site-header")),
      panel: r(document.querySelector(".planet-panel")),
    };
  });
  expect(boxes.visual).not.toBeNull();
  expect(boxes.panel).not.toBeNull();
  if (!boxes.visual || !boxes.panel) return;
  const total = boxes.visual.w + boxes.panel.w;
  // 30/70 width shares of the two panels (of each other, so body
  // padding and the inter-panel gap don't shift the ratio).
  expect(boxes.visual.w / total).toBeGreaterThan(0.26);
  expect(boxes.visual.w / total).toBeLessThan(0.34);
  // Square whenever they fit: the 30% panel is narrow enough that its
  // aspect-square height fits the viewport.
  expect(Math.abs(boxes.visual.w - boxes.visual.h)).toBeLessThanOrEqual(2);
  // Corner radius 25% on both panels.
  expect(boxes.visual.radius).toContain("25%");
  expect(boxes.panel.radius).toContain("25%");
  // Side by side with no overlap: visual right edge at or before the
  // panel's left edge.
  expect(boxes.visual.x + boxes.visual.w).toBeLessThanOrEqual(boxes.panel.x + 1);
});

test("narrow screens stack the panels in page flow, never overlapping", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
  const boxes = await page.evaluate(() => {
    const r = (el: Element | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    return {
      visual: r(document.querySelector(".site-header")),
      panel: r(document.querySelector(".planet-panel")),
      scrollable: document.body.scrollHeight > window.innerHeight + 1,
    };
  });
  expect(boxes.visual).not.toBeNull();
  expect(boxes.panel).not.toBeNull();
  if (!boxes.visual || !boxes.panel) return;
  // Sequential stack: the visual panel sits wholly above the controls
  // panel in the page scroll — adjacent in flow, never overlapping.
  expect(boxes.visual.y + boxes.visual.h).toBeLessThanOrEqual(boxes.panel.y + 1);
  // Full-width panels and a page that scrolls between them.
  expect(boxes.visual.w).toBeGreaterThan(300);
  expect(boxes.panel.w).toBeGreaterThan(300);
  expect(boxes.scrollable).toBe(true);
});

test("every route renders signed in and gates signed out", async ({ page }) => {
  await withoutTour(page);
  const routes: { path: string; marker: string }[] = [
    { path: "/ranks", marker: "Live board" },
    { path: "/ranks", marker: "Your progress" },
    { path: "/ranks", marker: "Leagues & duels" },
    { path: "/prompts", marker: "My prompts" },
    { path: "/console", marker: "Submit a prompt" },
    { path: "/console", marker: "Create a challenge instead" },
    { path: "/account", marker: "Keep your arena ID" },
    { path: "/account", marker: "Local runtimes" },
    { path: "/account", marker: "App updates" },
    { path: "/account", marker: "Reset data" },
  ];
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator(`text=${route.marker}`).first()).toBeVisible();
  }
  // Batch ablation is parked behind its flag: prompts ships without it.
  await page.goto("/prompts");
  await expect(page.locator("text=Batch ablation queue")).toHaveCount(0);
  // Docs are public; everything else gates behind sign-in.
  await page.goto("/docs");
  await expect(page.locator("text=First run, end to end").first()).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.locator(".signin-card")).toBeVisible();
  }
  await page.goto("/docs");
  await expect(page.locator(".signin-card")).toHaveCount(0);
});

test("enlarged visuals stay centered with Shrink on-screen", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await withoutTour(page);
  // Rich history: several runs with long provider names — the shape
  // that once pushed the enlarged overlay sideways and Shrink
  // off-screen.
  await page.addInitScript(() => {
    const alloc = {
      housing: 15,
      transit: 10,
      health: 15,
      green: 10,
      reserves: 15,
      rescue: 12,
      shelter: 11,
      repair: 12,
    };
    const providers = [
      "demo",
      "local/meta/muse-glimmer",
      "ollama/hermes3:8b",
      "local/meta/muse-glimmer",
      "ollama/hermes3:8b",
      "demo",
      // Hostile width probe: a spaceless provider id that would force
      // a sideways scrollbar without the overlay's clip + wrap guards.
      "local/registry.example.com/deeply/nested/model-family/variant-20261102-ultra-long-context-window-edition",
    ];
    const entries = providers.map((provider, i) => {
      const turns = Array.from({ length: 12 }, (_, t) => ({
        turn: t + 1,
        state_hash: `d-${String(i)}-${String(t)}`,
        skip_reason: null,
        tokens_used: 280,
        usage_anomaly: false,
        spend: 105000,
        allocation: { ...alloc },
        policies: [],
      }));
      return {
        when: new Date(Date.now() - i * 86400000).toISOString(),
        seed: i + 1,
        provider,
        prompt: "Hold reserves.",
        game: "city",
        impact: 36 + i,
        efficiency: 3.6,
        model: provider,
        result: {
          seed: i + 1,
          provider,
          scores: { impact: 36 + i, efficiency: 3.6 },
          totals: { tokens_used: 3360, spend: 1260000, usage_anomalies: 0 },
          loss_reasons: [],
          turns,
          badges: [],
          strategy: {
            mean_allocation: { ...alloc },
            policies: {},
            played_turns: 12,
            skipped_turns: 0,
          },
          prompt_words: 12,
          token_budget: 15000,
        },
      };
    });
    window.localStorage.setItem("aim-arena-history", JSON.stringify(entries));
  });
  await page.goto("/console");
  await page.locator("section.history").scrollIntoViewIfNeeded();
  const slot = page.locator(".moon-stage-slot");
  await slot.getByRole("button", { name: "Enlarge visual" }).click();
  await expect(page.locator(".moon-stage-slot.is-big")).toBeVisible();
  const metrics = await page.evaluate(() => {
    const el = document.querySelector(".moon-stage-slot.is-big");
    if (!(el instanceof HTMLElement)) return null;
    const button = el.querySelector(".moon-stage-tools button");
    const child = el.children.item(1);
    const b = button instanceof HTMLElement ? button.getBoundingClientRect() : null;
    const c = child instanceof HTMLElement ? child.getBoundingClientRect() : null;
    const s = el.getBoundingClientRect();
    return {
      xScroll: el.scrollWidth - el.clientWidth,
      shrinkVisible: b !== null && b.left >= -1 && b.right <= window.innerWidth + 1,
      // Centered: equal gutters left and right of the first visual.
      gutterSkew: c === null ? 0 : Math.abs(c.left - s.left - (s.right - c.right)),
      // The Shrink control itself sits centered in the popup.
      shrinkSkew: b === null ? 0 : Math.abs(b.left + b.right - (s.left + s.right)) / 2,
    };
  });
  expect(metrics).not.toBeNull();
  if (!metrics) return;
  expect(metrics.xScroll).toBeLessThanOrEqual(1);
  expect(metrics.shrinkVisible).toBe(true);
  expect(metrics.gutterSkew).toBeLessThanOrEqual(2);
  expect(metrics.shrinkSkew).toBeLessThanOrEqual(2);
});

test("console deep-links preload the run form", async ({ page }) => {
  await withoutTour(page);
  // No open play: a bare seed link still arms the given trial
  // (debut, seed fixed to 1) instead of a free prompt.
  await page.goto("/console?seed=4242");
  await expect(page.locator("#challenge")).toHaveValue("debut");
  await expect(page.locator("#seed")).toHaveValue("1");
  // A challenge link fixes the seed (debut runs on seed 1) and fills
  // the prompt.
  await page.goto("/console?challenge=debut&prompt=deep-link-probe");
  await expect(page.locator("#prompt")).toHaveValue("deep-link-probe");
  await expect(page.locator("#seed")).toHaveValue("1");
  await expect(page.locator("#challenge")).toHaveValue("debut");
  // A bare pack link with the tote still locked falls back to the
  // given city trial — no taskless pack form exists anymore.
  await page.goto("/console?game=tote&prompt=tote-probe&seed=3");
  await expect(page.locator("#challenge")).toHaveValue("debut");
  await expect(page.locator("#prompt")).toBeVisible();
  await expect(page.locator("#tote-prompt")).toHaveCount(0);
  // A tote task link stays shut while locked: the locked link
  // leaves the earlier debut pick alone, city form showing.
  await page.goto("/console?challenge=market-day");
  await expect(page.locator("#challenge")).toHaveValue("debut");
  await expect(page.locator("#tote-prompt")).toHaveCount(0);
  // Once debut clears, the same link arms the packing shift (market
  // day runs on seed 3).
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aim-arena-challenges",
      JSON.stringify({
        debut: { when: "2026-11-02", impact: 50, efficiency: 12, model: "demo" },
      }),
    );
  });
  await page.goto("/console?challenge=market-day");
  await expect(page.locator("#challenge")).toHaveValue("market-day");
  await expect(page.locator("#tote-seed")).toHaveValue("3");
  await expect(page.locator("#tote-seed")).toBeDisabled();
  // And a bare pack link now arms that unlocked tote, prompt filled.
  await page.goto("/console?game=tote&prompt=tote-probe");
  await expect(page.locator("#challenge")).toHaveValue("market-day");
  await expect(page.locator("#tote-prompt")).toHaveValue("tote-probe");
  await expect(page.locator("#prompt")).toHaveCount(0);
});

test("console explains the chain, the land moves, and model auto-connect", async ({
  page,
}) => {
  await withoutTour(page);
  await page.goto("/console?challenge=debut");
  // The picker states the rhythm: one alternating endless chain, with
  // drills as practice that never gates it.
  await expect(
    page.locator("text=alternate down one endless chain").first(),
  ).toBeVisible();
  await expect(
    page.locator('#challenge optgroup[label="Prompting drills — practice, no rank"]'),
  ).toHaveCount(1);
  // The field plan quotes each move's effect and the shock timing, so
  // a pick is a decision rather than a guess.
  await expect(page.locator("text=Prepare the land (optional)").first()).toBeVisible();
  await expect(page.locator("text=shocks land on turns 5 and 9").first()).toBeVisible();
  await expect(page.locator(".field-plan [role=status]")).toContainText(
    "+12 moisture on every live site",
  );
  await page.locator("#console-plan-kind").selectOption("vent_heat");
  await expect(page.locator(".field-plan [role=status]")).toContainText(
    "−14 heat on every live site",
  );
  // Local models connect themselves into the turn-player dropdown.
  await expect(
    page.locator("text=Local runtimes connect themselves").first(),
  ).toBeVisible();
  // The department brief names what each department converts money
  // into, plus the turn map — the amounts behind the craft names.
  await page.locator(".dept-brief > summary").click();
  await expect(page.locator(".dept-table")).toContainText("≈54 lives");
  await expect(page.locator(".turn-map")).toContainText("T5");
  await expect(page.locator(".turn-map")).toContainText("shock");
});

test("logo routes to the console signed in, home signed out", async ({ page }) => {
  await withoutTour(page);
  // Signed in: the header mark rides to the operator console.
  await page.goto("/ranks");
  await page.locator(".site-header .brand-mark").click();
  await expect(page).toHaveURL(/\/console$/);
  // The nav wordmark agrees.
  await page.goto("/ranks");
  await page.locator(".nav-panel .brand a").click();
  await expect(page).toHaveURL(/\/console$/);
  // The bottom planet logo agrees.
  await page.goto("/ranks");
  await page.locator(".planet-home-btn").click();
  await expect(page).toHaveURL(/\/console$/);
  // Signed out: the marks ride home.
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/");
  await page.locator(".site-header .brand-mark").click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/docs");
  await page.locator(".planet-home-btn").click();
  await expect(page).toHaveURL(/\/$/);
});

test("submit breathes full width until a verdict lands", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await withoutTour(page);
  await page.goto("/console");
  const play = await page.locator(".console-play").boundingBox();
  const submit = await page.locator(".console-play .submit").boundingBox();
  expect(play).not.toBeNull();
  expect(submit).not.toBeNull();
  // No result yet: the form spans the play grid, not a side track.
  expect((submit?.width ?? 0) / (play?.width ?? 1)).toBeGreaterThan(0.9);
});

test("left panel follows its section until touched", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await withoutTour(page);
  await page.addInitScript(() => {
    const turns = Array.from({ length: 12 }, (_, index) => ({
      turn: index + 1,
      state_hash: "abc123",
      skip_reason: null,
      tokens_used: 400,
      usage_anomaly: false,
      spend: 10,
      allocation: { housing: 50, health: 30, green: 20 },
      policies: ["shelter-first"],
      impact: 50 + index,
      efficiency: 5,
    }));
    const result = {
      provider: "smoke",
      seed: 7,
      turns,
      scores: { impact: 60.12, efficiency: 14.67 },
      totals: { tokens_used: 8178 },
      badges: [],
      loss_reasons: [],
      prompt_words: 40,
      token_budget: 15000,
      strategy: {
        mean_allocation: {},
        policies: {},
        played_turns: 12,
        skipped_turns: 0,
      },
    };
    window.localStorage.setItem(
      "aim-arena-history",
      JSON.stringify([
        {
          when: "2026-11-03",
          seed: 7,
          provider: "smoke",
          prompt: "first",
          game: "city",
          impact: 60.12,
          efficiency: 14.67,
          result,
        },
        {
          when: "2026-11-04",
          seed: 8,
          provider: "smoke",
          prompt: "second",
          game: "city",
          impact: 61.0,
          efficiency: 15.0,
          result: { ...result, seed: 8 },
        },
      ]),
    );
  });
  await page.goto("/console");
  const panel = page.locator(".site-header .visual-scroll");
  // Center the history section: it drives a dashboard taller than
  // the square, and the panel drifts with the traversal.
  await page.locator("section.history").evaluate((el) => {
    el.scrollIntoView({ block: "center" });
  });
  await expect(page.locator(".moon-stage-slot .analytics-dashboard")).toBeVisible();
  const maxScroll = await panel.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(maxScroll).toBeGreaterThan(200);
  await expect
    .poll(() => panel.evaluate((el) => el.scrollTop), { timeout: 5000 })
    .toBeGreaterThan(maxScroll * 0.3);
  // Gradual follow: easing the right panel's own container back
  // moves the section down, and the left panel drifts back with it.
  // (The window never scrolls on this layout — window.scrollTo
  // no-ops — and centering already maxes the shell, so only upward
  // travel is possible from here.)
  const drifted = await panel.evaluate((el) => el.scrollTop);
  await page.evaluate(() => {
    const shell = document.querySelector(".console-page .shell");
    if (shell !== null) {
      shell.scrollTop -= 200;
    }
  });
  await expect
    .poll(() => panel.evaluate((el) => el.scrollTop), { timeout: 5000 })
    .toBeLessThan(drifted - 50);
  // A manual touch pins it: further main scrolls leave it put.
  const before = await panel.evaluate((el) => el.scrollTop);
  await panel.hover();
  await page.mouse.wheel(0, 300);
  // The native wheel scroll lands async: wait for it before reading
  // the pinned value, or the read races the wheel and the pin
  // assertion below fails on the wheel's own delta.
  await expect
    .poll(() => panel.evaluate((el) => el.scrollTop), { timeout: 2000 })
    .toBeGreaterThan(before);
  await page.waitForTimeout(200);
  const pinned = await panel.evaluate((el) => el.scrollTop);
  await page.evaluate(() => {
    const shell = document.querySelector(".console-page .shell");
    if (shell !== null) {
      shell.scrollTop += 300;
    }
  });
  await page.waitForTimeout(400);
  await expect(panel.evaluate((el) => el.scrollTop)).resolves.toBe(pinned);
  // The challenge was real: history still drives the dashboard, so
  // an unpinned panel would have drifted back toward center.
  await expect(page.locator(".moon-stage-slot .analytics-dashboard")).toBeVisible();
});

test("docs swaps shells with sign-in state", async ({ page }) => {
  await withoutTour(page);
  // Auto-login: signed-in docs wear the console shell with the nav.
  await page.goto("/docs");
  await expect(page.locator(".shell-main")).toBeVisible();
  await expect(page.locator(".nav-panel")).toBeVisible();
  // Signed out, docs stay public in the landing shell — no nav, no gate.
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/docs");
  await expect(page.locator(".landing-section")).toBeVisible();
  await expect(page.locator(".nav-panel")).toHaveCount(0);
  await expect(page.locator(".signin-card")).toHaveCount(0);
  await expect(page.locator("text=Create and dress a challenge").first()).toBeVisible();
});

test("console asks simulate-or-create once, then remembers", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("simulate.tourSeen", "1");
  });
  await page.goto("/console");
  await expect(page.locator("#mode-gate-heading")).toBeVisible();
  await expect(page.locator("#challenge")).toHaveCount(0);
  // Simulate opens the play section and persists the pick.
  await page.getByRole("button", { name: "Simulate a trial" }).click();
  await expect(page.locator("#challenge")).toBeVisible();
  await expect(page.locator("#mode-gate-heading")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#challenge")).toBeVisible();
  // The switch flips to the creator and back.
  await page.getByRole("button", { name: "Create a challenge instead" }).click();
  await expect(page.locator("#create-heading")).toBeVisible();
  await expect(page.locator("#challenge")).toHaveCount(0);
  await page.getByRole("button", { name: "Simulate instead" }).click();
  await expect(page.locator("#challenge")).toBeVisible();
});

test("console deep links skip the mode gate", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("simulate.tourSeen", "1");
  });
  await page.goto("/console?challenge=debut");
  await expect(page.locator("#challenge")).toHaveValue("debut");
  await expect(page.locator("#mode-gate-heading")).toHaveCount(0);
});

test("console play swaps city and tote around one picker", async ({ page }) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aim-arena-challenges",
      JSON.stringify({
        debut: { when: "2026-11-02", impact: 50, efficiency: 12, model: "demo" },
      }),
    );
  });
  await page.goto("/console");
  // Debut cleared, so the console arms the given trial itself: the
  // next play is the market-day pack-out, tote half showing.
  await expect(page.locator("#challenge")).toHaveValue("market-day");
  await expect(page.locator("#submit-heading")).toHaveText("Pack the tote");
  await expect(page.locator("#tote-prompt")).toBeVisible();
  await expect(page.locator("#prompt")).toHaveCount(0);
  // Back to a city trial: the city half returns, tote unmounts.
  await page.locator("#challenge").selectOption("debut");
  await expect(page.locator("#submit-heading")).toHaveText("Submit a prompt");
  await expect(page.locator("#prompt")).toBeVisible();
  await expect(page.locator("#tote-prompt")).toHaveCount(0);
  // No open play rides the picker anymore — trials only.
  await expect(page.locator('#challenge option[value=""]')).toHaveCount(0);
  await expect(page.locator('#challenge option[value="open-tote"]')).toHaveCount(0);
});

test("nav pills reach every page", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator("text=Run match")).toBeVisible();
  for (const name of ["Ranks", "My prompts", "Docs", "Account"]) {
    await page.getByRole("link", { name }).first().click();
    await expect(page.locator(".shell-main")).toBeVisible();
  }
});

test("first-run tour is readable, dismisses, and unblocks clicks", async ({ page }) => {
  // Fresh visits auto-login, so the tour arms on the very first load.
  await page.goto("/console");
  const tour = page.getByRole("dialog", { name: "Onboarding tour" });
  await expect(tour).toBeVisible();
  const { alpha, lightnessGap } = await cardReadability(
    page,
    '[role="dialog"][aria-label="Onboarding tour"] > div',
    '[role="dialog"][aria-label="Onboarding tour"] h2',
  );
  expect(alpha).toBe(1);
  expect(lightnessGap).toBeGreaterThan(40);
  // Skip must be a real working click (a transparent modal eats these).
  await tour.getByRole("button", { name: "Skip" }).click();
  await expect(tour).toHaveCount(0);
  // Dismissal persists: no tour on the next visit.
  await page.goto("/console");
  await expect(tour).toHaveCount(0);
  // Clicks reach the page again: signed in, the planet logo
  // rides to the operator console.
  await page.goto("/ranks");
  await page.locator(".planet-home-btn").click();
  await expect(page).toHaveURL(/\/console$/);
});

test("city canvas paints a live frame with no error UI", async ({ page }) => {
  await withoutTour(page);
  await page.goto("/console");
  await expect(page.locator(".moon-stage-slot figure.stage3d canvas")).toBeVisible();
  await expect(page.locator(".moon-stage-slot .error")).toHaveCount(0);
  // The frame is rich (ground, towers, discs) and it advances: the
  // replay clock drives every Canvas2D stage with no GL involved.
  const sample = (): Promise<{ lit: number; bytes: number }> =>
    page.evaluate(() => {
      const el = document.querySelector(".moon-stage-slot figure.stage3d canvas");
      if (!(el instanceof HTMLCanvasElement)) throw new Error("no stage canvas");
      const probe = document.createElement("canvas");
      probe.width = 32;
      probe.height = 32;
      const ctx = probe.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      ctx.drawImage(el, 0, 0, 32, 32);
      const data = ctx.getImageData(0, 0, 32, 32).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (r + g + b > 45 && a > 16) {
          lit += 1;
        }
      }
      return { lit, bytes: el.toDataURL("image/png").length };
    });
  const first = await sample();
  expect(first.lit).toBeGreaterThan(100);
  await page.waitForTimeout(1200);
  const second = await sample();
  expect(second.bytes).not.toBe(first.bytes);
});

test("tote canvas paints a live frame with no error UI", async ({ page }) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "aim-arena-challenges",
      JSON.stringify({
        debut: { when: "2026-11-02", impact: 50, efficiency: 12, model: "demo" },
      }),
    );
  });
  await page.goto("/console?game=tote");
  await expect(page.locator(".moon-stage-slot figure.stage3d canvas")).toBeVisible();
  await expect(page.locator(".moon-stage-slot .error")).toHaveCount(0);
  const lit = await page.evaluate(() => {
    const el = document.querySelector(".moon-stage-slot figure.stage3d canvas");
    if (!(el instanceof HTMLCanvasElement)) throw new Error("no stage canvas");
    const probe = document.createElement("canvas");
    probe.width = 32;
    probe.height = 32;
    const ctx = probe.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(el, 0, 0, 32, 32);
    const data = ctx.getImageData(0, 0, 32, 32).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      const a = data[i + 3] ?? 0;
      if (r + g + b > 45 && a > 16) {
        count += 1;
      }
    }
    return count;
  });
  expect(lit).toBeGreaterThan(100);
});

test("left panel shows the page title where no visual is published", async ({
  page,
}) => {
  await withoutTour(page);
  // Account and docs publish no stage: the title owns the panel.
  await page.goto("/account");
  const chip = page.locator(".site-header .moon-stage-title");
  await expect(chip).toHaveText("Your account");
  // Sticker chip: signal-yellow fill, near-black type, tilted.
  await expect(chip).toHaveCSS("background-color", "rgb(255, 230, 77)");
  await expect(chip).toHaveCSS("color", "rgb(26, 16, 5)");
  const tilt = await chip.evaluate((el) => getComputedStyle(el).transform);
  expect(tilt).not.toBe("none");
  await expect(page.locator(".site-header .moon-stage-slot")).toHaveCount(0);
  await page.goto("/docs");
  await expect(page.locator(".site-header .moon-stage-title")).toHaveText(
    "What it does",
  );
  // Idle prompts (no run detail in view) fall back to the title.
  await page.goto("/prompts");
  await expect(page.locator(".site-header .moon-stage-title")).toHaveText(
    "Prompt history",
  );
  // A published stage always wins over the title.
  await page.goto("/console");
  await expect(page.locator(".moon-stage-slot figure.stage3d")).toBeVisible();
  await expect(page.locator(".site-header .moon-stage-title")).toHaveCount(0);
  await page.goto("/ranks");
  await expect(page.locator(".site-header .moon-stage-slot")).toBeVisible();
  await expect(page.locator(".site-header .moon-stage-title")).toHaveCount(0);
  // Signed-out gates show the title too.
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".signin-card")).toBeVisible();
  await expect(page.locator(".site-header .moon-stage-title")).toHaveText(
    "Your account",
  );
  await page.goto("/console");
  await expect(page.locator(".site-header .moon-stage-title")).toHaveText(
    "Operator console",
  );
});

test("an imported trial code stores a shared trial and simulates it", async ({
  page,
}) => {
  await withoutTour(page);
  const payload = {
    version: 1,
    kind: "trial",
    trial: {
      proposalId: 4242,
      title: "Ember watch trials",
      description: "Hold the ridge through ember season.",
      model: "ollama/hermes3:8b",
      inputPrompt: "Allocate the ridge budget.",
      outputFormat: "JSON allocations per turn",
      restrictions: null,
      ownerUid: "11111111-2222-4333-8444-555555555555",
      ownerNickname: "rook",
    },
  };
  const code = `AIM1.${Buffer.from(JSON.stringify(payload), "utf8").toString("base64")}`;
  await page.goto("/ranks");
  await page.locator("#league-import").fill(code);
  await page.getByRole("button", { name: "Import code" }).click();
  const trials = page.locator("section[aria-labelledby='league-trials-heading']");
  await expect(trials.getByText("Ember watch trials")).toBeVisible();
  await trials.getByRole("button", { name: "Simulate this trial" }).click();
  await expect(page).toHaveURL(/\/console\?challenge=rotation-4242/);
  // The console resolves the stored snapshot and arms the trial:
  // the brief shows its title instead of the unified chain's pick.
  await expect(page.locator("text=Ember watch trials").first()).toBeVisible();
  await expect(page.locator("#seed")).toBeDisabled();
});

test("tour walks every page and restarts from account", async ({ page }) => {
  // No tourSeen pre-mark: the first-run tour arms on the console.
  await page.addInitScript(() => {
    window.localStorage.setItem("aim-console-mode", "play");
  });
  await page.goto("/console");
  const tour = page.getByRole("dialog", { name: "Onboarding tour" });
  await expect(tour).toBeVisible({ timeout: 10000 });
  await expect(tour).toContainText("Step 1 of 10");
  await expect(tour).toContainText("Pick your trial");
  // Console steps first, then the tour hops pages on its own.
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Step 2 of 10");
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour).toContainText("Step 1 of 10");
  for (let hop = 0; hop < 4; hop += 1) {
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour).toContainText("Step 5 of 10");
  await expect(page).toHaveURL(/\/prompts$/);
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour).toContainText("Step 6 of 10");
  await expect(page).toHaveURL(/\/ranks$/);
  // Escape dismisses like Skip, and the dismissal persists.
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  await page.goto("/account");
  await expect(tour).toHaveCount(0);
  // The Account restart replays it from the top, console first.
  await page.getByRole("button", { name: "Start the tour" }).click();
  await expect(tour).toBeVisible();
  await expect(page).toHaveURL(/\/console$/);
  await expect(tour).toContainText("Step 1 of 10");
  await tour.getByRole("button", { name: "Skip" }).click();
  await expect(tour).toBeHidden();
});

test("prompt craft scores the draft live and reports your correlation", async ({
  page,
}) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    const strong =
      "Fund housing 30%, health 25%, transit 15%, green 10%, rescue 10%, shelter 10%. " +
      "Keep reserves at 15% or more, never below the floor. If a flood hits, shift to rescue " +
      "and shelter; when heat rises, fund green. Pre-position before the turn 5 shock. " +
      "Reply with JSON only, concise.";
    const weak = "help the city please";
    const mk = (when: string, seed: number, prompt: string, impact: number) => ({
      when,
      seed,
      provider: "smoke",
      prompt,
      game: "city",
      impact,
      efficiency: 10,
    });
    window.localStorage.setItem(
      "aim-arena-history",
      JSON.stringify([
        mk("2026-11-01", 1, strong, 80),
        mk("2026-11-02", 2, strong, 70),
        mk("2026-11-03", 3, weak, 40),
        mk("2026-11-04", 4, weak, 50),
      ]),
    );
  });
  await page.goto("/console");
  const craftPanel = page.locator(".prompt-craft");
  await expect(craftPanel).toBeVisible();
  await expect(craftPanel.locator(".prompt-craft-score")).toHaveText("0/100");
  await page
    .locator("#prompt")
    .fill(
      "Fund housing 30%, health 25%, transit 15%, green 10%, rescue 10%, shelter 10%. " +
        "Keep reserves at 15% or more, never below the floor. If a flood hits, shift to rescue " +
        "and shelter; when heat rises, fund green. Pre-position before the turn 5 shock. " +
        "Reply with JSON only, concise.",
    );
  await expect(craftPanel.locator(".prompt-craft-score")).toHaveText("100/100");
  await expect(page.locator("section.history")).toContainText(
    "Your structured prompts",
  );
});

test("fix drill prefills the flawed draft and the rewrite raises craft", async ({
  page,
}) => {
  await withoutTour(page);
  await page.goto("/console");
  await page.locator("#challenge").selectOption("drill-fix");
  // The drill arms with its flawed draft in the editor, seed locked.
  await expect(page.locator("#prompt")).toHaveValue(/Spend everything on housing/);
  await expect(page.locator("#seed")).toHaveValue("11");
  await expect(page.locator("#seed")).toBeDisabled();
  const craftPanel = page.locator(".prompt-craft");
  const before = await craftPanel.locator(".prompt-craft-score").textContent();
  expect(before).not.toBe("100/100");
  // Rewrite it structured: the craft checklist climbs to full.
  await page
    .locator("#prompt")
    .fill(
      "Fund housing 30%, health 25%, transit 15%, green 10%, rescue 10%, shelter 10%. " +
        "Keep reserves at 15% or more, never below the floor. If a flood hits, shift to rescue " +
        "and shelter; when heat rises, fund green. Pre-position before the turn 5 shock. " +
        "Reply with JSON only, concise.",
    );
  await expect(craftPanel.locator(".prompt-craft-score")).toHaveText("100/100");
  // Compression drill enforces its own word cap.
  await page.locator("#challenge").selectOption("drill-eighty");
  await expect(page.locator("section.submit")).toContainText("/ 80 words");
});

test("focus card names a drill from repeated weak prompts", async ({ page }) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    const weak = "help the city please";
    const mk = (when: string) => ({
      when,
      seed: 1,
      provider: "smoke",
      prompt: weak,
      game: "city",
      impact: 40,
      efficiency: 10,
    });
    window.localStorage.setItem(
      "aim-arena-history",
      JSON.stringify([mk("2026-11-01"), mk("2026-11-02"), mk("2026-11-03")]),
    );
  });
  await page.goto("/console");
  const card = page.locator(".focus-card");
  await expect(card).toBeVisible();
  await expect(card.locator("h3")).toContainText("Your focus");
  await expect(card).toContainText("Play the drill");
});

test("clearing history also clears the cleared-trial data", async ({ page }) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("aim-console-mode", "play");
    // Init scripts re-run on every navigation: seed once per tab,
    // or later visits would resurrect the wiped data under test.
    if (window.sessionStorage.getItem("smoke-wipe-seeded") !== null) {
      return;
    }
    window.sessionStorage.setItem("smoke-wipe-seeded", "1");
    window.localStorage.setItem(
      "aim-arena-history",
      JSON.stringify([
        {
          when: "2026-11-01",
          seed: 1,
          provider: "smoke",
          prompt: "steward the city",
          game: "city",
          impact: 60.12,
          efficiency: 35.97,
        },
      ]),
    );
    window.localStorage.setItem(
      "aim-arena-challenges",
      JSON.stringify({
        debut: { when: "2026-11-01", impact: 36.0, efficiency: 12, model: "demo" },
        "flood-wall": {
          when: "2026-11-01",
          impact: 60.12,
          efficiency: 35.97,
          model: "demo",
        },
      }),
    );
  });
  await page.goto("/console");
  const panel = page.locator(".challenges-panel");
  await expect(panel).toContainText("2 trials cleared");
  await expect(panel).toContainText("Best impact 60.12");
  // The mode switch sits centered in its pill, not hugging the left.
  const pill = page.locator(".mode-switch");
  const switchBox = await pill
    .getByRole("button", { name: "Create a challenge instead" })
    .boundingBox();
  const pillBox = await pill.boundingBox();
  expect(switchBox).not.toBeNull();
  expect(pillBox).not.toBeNull();
  if (switchBox && pillBox) {
    const switchCenter = switchBox.x + switchBox.width / 2;
    const pillCenter = pillBox.x + pillBox.width / 2;
    expect(Math.abs(switchCenter - pillCenter)).toBeLessThan(24);
    const switchMid = switchBox.y + switchBox.height / 2;
    const pillMid = pillBox.y + pillBox.height / 2;
    expect(Math.abs(switchMid - pillMid)).toBeLessThan(4);
  }
  // The console keeps no reset controls: the wipe lives on Account.
  await expect(page.getByRole("button", { name: "Clear history" })).toHaveCount(0);
  await page.goto("/account");
  await page.getByRole("button", { name: "Clear history and trials" }).click();
  await expect(page.locator("text=Cleared. The console")).toBeVisible();
  // History-derived bests and clears go with the history: back on
  // the console, the panel must not show trials the player wiped.
  await page.goto("/console");
  await expect(panel).toContainText("0 trials cleared");
  await expect(panel).toContainText("No cleared trials yet");
  await expect(page.locator("text=Nothing recorded yet.")).toBeVisible();
  // And the wipe is in storage, not just on screen.
  await page.reload();
  await expect(panel).toContainText("0 trials cleared");
});

test("the run form never overlaps the challenges glance", async ({ page }) => {
  // 1400px lands the play grid side by side (result beside form);
  // wider viewports fall back to one column under the circle cap.
  await page.setViewportSize({ width: 1400, height: 1000 });
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("aim-console-mode", "play");
    // Two clears: the glance has rows and the tote task is
    // unlocked. The pack below misses its bar on purpose, so the
    // console never auto-advances off the tote form under test.
    window.localStorage.setItem(
      "aim-arena-challenges",
      JSON.stringify({
        debut: { when: "2026-11-01", impact: 36.0, efficiency: 12, model: "demo" },
        "flood-wall": {
          when: "2026-11-01",
          impact: 60.12,
          efficiency: 35.97,
          model: "demo",
        },
      }),
    );
  });
  await page.route("**/api/contract", (route) =>
    route.fulfill({
      json: {
        sim_version: "smoke",
        turns: 12,
        prompt_max_words: 250,
        token_budget: 12000,
        turn_token_cap: 800,
        models: [{ id: "demo", kind: "local" }],
      },
    }),
  );
  await page.route("**/api/tote", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        json: {
          seed: 3,
          provider: "demo",
          uid: "smoke",
          offered: ["bucket"],
          packing: ["bucket"],
          value: 6,
          damage: { overweight: 0, crush: 0, stain: 0, cut: 0, total: 0 },
          score: 8.5,
          totals: { tokens_used: 1200 },
          invalid_reason: null,
          scarce: [],
          wildcards: [],
          badges: [],
          bonus: 0,
          usage_anomaly: false,
        },
      });
    }
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "catalog") {
      return route.fulfill({
        json: {
          capacity_kg: 20,
          items: [
            {
              id: "bucket",
              label: "Bucket",
              weight: 1,
              value: 3,
              fragile: false,
              tags: [],
            },
          ],
        },
      });
    }
    return route.fulfill({ json: { seed: 3, offered: ["bucket"], scarce: [] } });
  });
  await page.route("**/api/runs", (route) =>
    route.fulfill({ json: { position: null } }),
  );
  await page.goto("/console?challenge=market-day");
  await page.locator("#tote-prompt").fill("heavy low, fragile high");
  await page.getByRole("button", { name: "Pack tote" }).click();
  await expect(page.locator(".console-play .result")).toBeVisible({ timeout: 15000 });
  // The verdict puts the grid side by side; scrolling the glance
  // into view must not drag the tall form down over it.
  await page.locator(".challenges-panel").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const submitBox = await page.locator(".console-play .submit").boundingBox();
  const glanceBox = await page.locator(".challenges-panel").boundingBox();
  expect(submitBox).not.toBeNull();
  expect(glanceBox).not.toBeNull();
  if (submitBox && glanceBox) {
    const separated =
      submitBox.x + submitBox.width <= glanceBox.x ||
      glanceBox.x + glanceBox.width <= submitBox.x ||
      submitBox.y + submitBox.height <= glanceBox.y ||
      glanceBox.y + glanceBox.height <= submitBox.y;
    expect(separated).toBe(true);
  }
});

test("judge button offers a rubric verdict after a run", async ({ page }) => {
  await withoutTour(page);
  // The console prefers the same-origin proxies (/api/contract,
  // /api/match); host mocking covers the direct-sim fallback if
  // the proxy is ever down.
  await page.route("**/api/contract", (route) =>
    route.fulfill({
      json: {
        sim_version: "smoke",
        turns: 12,
        prompt_max_words: 200,
        token_budget: 2000,
        turn_token_cap: 400,
        models: [{ id: "demo", kind: "local" }],
      },
    }),
  );
  // No stream endpoint on this sim: the run falls back to the
  // blocking match call below.
  await page.route("**/api/match-stream", (route) =>
    route.fulfill({ status: 404, json: { error: "no stream" } }),
  );
  await page.route("**/api/match", (route) =>
    route.fulfill({
      json: {
        seed: 1,
        provider: "smoke",
        scores: { impact: 62, efficiency: 8 },
        totals: { tokens_used: 1200 },
        loss_reasons: [],
        turns: Array.from({ length: 12 }, (_, i) => ({
          turn: i + 1,
          state_hash: `judge-${String(i)}`,
          skip_reason: null,
          tokens_used: 100,
          usage_anomaly: false,
          spend: 10,
          allocation: { housing: 50, health: 30, green: 20 },
          policies: [],
          impact: 55 + (i === 6 ? -12 : 0),
          efficiency: 5,
        })),
        badges: [],
        strategy: {
          mean_allocation: { housing: 50, health: 30, green: 20 },
          policies: {},
          played_turns: 12,
          skipped_turns: 0,
        },
        prompt_words: 40,
        token_budget: 2000,
      },
    }),
  );
  // The judge has no same-origin proxy: it posts to the sim host
  // directly, so its route is the sim path suffix.
  await page.route("**/prompt/judge", (route) =>
    route.fulfill({
      json: {
        verdict: {
          scores: { clarity: 8, specificity: 7, contingency: 6, economy: 9 },
          advice: ["Name the reserve floor."],
        },
        provider: "smoke",
        model: "demo",
        tokens_used: 120,
      },
    }),
  );
  await page.goto("/console");
  await page
    .locator("#prompt")
    .fill(
      "Fund housing 30%, health 25%, transit 15%, green 10%, rescue 10%, shelter 10%. " +
        "Keep reserves at 15% or more. If a flood hits, shift to rescue.",
    );
  await page.getByRole("button", { name: "Run match" }).click();
  await expect(page.locator(".aftermath, [class*=aftermath]").first()).toBeVisible({
    timeout: 15000,
  });
  const judgeButton = page.getByRole("button", { name: "Judge this prompt" });
  await expect(judgeButton).toBeVisible({ timeout: 10000 });
  await judgeButton.click();
  await expect(page.locator(".judge-scores")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".judge-label").first()).toContainText("Clarity");
});

test("streamed runs report progress on the run button", async ({ page }) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("aim-console-mode", "play");
  });
  await page.route("**/api/contract", (route) =>
    route.fulfill({
      json: {
        sim_version: "smoke",
        turns: 12,
        prompt_max_words: 200,
        token_budget: 2000,
        turn_token_cap: 400,
        models: [{ id: "demo", kind: "local" }],
      },
    }),
  );
  const result = {
    seed: 1,
    provider: "smoke",
    scores: { impact: 62, efficiency: 8 },
    totals: { tokens_used: 1200 },
    loss_reasons: [],
    turns: Array.from({ length: 12 }, (_, i) => ({
      turn: i + 1,
      state_hash: `stream-${String(i)}`,
      skip_reason: null,
      tokens_used: 100,
      usage_anomaly: false,
      spend: 10,
      allocation: { housing: 50, health: 30, green: 20 },
      policies: [],
      impact: 55,
      efficiency: 5,
    })),
    badges: [],
    strategy: {
      mean_allocation: { housing: 50, health: 30, green: 20 },
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
    prompt_words: 40,
    token_budget: 2000,
  };
  const frames = Array.from(
    { length: 12 },
    (_, i) =>
      `data: ${JSON.stringify({ type: "turn", turn: i + 1, total: 12, tokens_used: 100, skipped: false, impact: 55, efficiency: 5 })}\n\n`,
  ).join("");
  await page.route("**/api/match-stream", (route) => {
    // Hold the stream briefly so the pre-turn state is observable.
    setTimeout(() => {
      void route.fulfill({
        body: `${frames}data: ${JSON.stringify({ type: "result", result })}\n\n`,
        contentType: "text/event-stream",
      });
    }, 1200);
  });
  await page.goto("/console?challenge=debut");
  await page.locator("#prompt").fill("Fund housing, hold reserves, answer shocks.");
  const runButton = page.getByRole("button", { name: "Run match" });
  await runButton.click();
  // Before the first turn lands, the button says who it waits on.
  await expect(page.getByRole("button", { name: /Contacting model/ })).toBeVisible({
    timeout: 5000,
  });
  // The stream's result settles the verdict like a blocking run —
  // and clears debut, so the console advances to the tote shift.
  await expect(page.locator(".console-play .result")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Pack tote" })).toBeVisible({
    timeout: 10000,
  });
});

test("runs keep playing across menus and pop a completion toast", async ({ page }) => {
  await withoutTour(page);
  await page.route("**/api/contract", (route) =>
    route.fulfill({
      json: {
        sim_version: "smoke",
        turns: 12,
        prompt_max_words: 200,
        token_budget: 2000,
        turn_token_cap: 400,
        models: [{ id: "demo", kind: "local" }],
      },
    }),
  );
  const result = {
    seed: 1,
    provider: "smoke",
    scores: { impact: 62, efficiency: 8 },
    totals: { tokens_used: 1200 },
    loss_reasons: [],
    turns: Array.from({ length: 12 }, (_, i) => ({
      turn: i + 1,
      state_hash: `away-${String(i)}`,
      skip_reason: null,
      tokens_used: 100,
      usage_anomaly: false,
      spend: 10,
      allocation: { housing: 50, health: 30, green: 20 },
      policies: [],
      impact: 55,
      efficiency: 5,
    })),
    badges: [],
    strategy: {
      mean_allocation: { housing: 50, health: 30, green: 20 },
      policies: {},
      played_turns: 12,
      skipped_turns: 0,
    },
    prompt_words: 40,
    token_budget: 2000,
  };
  await page.route("**/api/match-stream", (route) => {
    // Hold the stream so the menu hop lands mid-run: a full page
    // load here would cancel the fetch and no toast would ever fire.
    setTimeout(() => {
      void route.fulfill({
        body: `data: ${JSON.stringify({ type: "result", result })}\n\n`,
        contentType: "text/event-stream",
      });
    }, 2500);
  });
  await page.goto("/console?challenge=debut");
  await page.locator("#prompt").fill("Fund housing, hold reserves, answer shocks.");
  await page.getByRole("button", { name: "Run match" }).click();
  await expect(page.getByRole("button", { name: /Contacting model/ })).toBeVisible({
    timeout: 5000,
  });
  // Leave mid-run: the menu hop is client-side, so the stream stays
  // open and the run settles while ranks is on screen.
  await page.getByRole("link", { name: "Ranks" }).first().click();
  await expect(page).toHaveURL(/\/ranks/, { timeout: 10000 });
  await expect(page.getByText("Simulation complete")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator(".run-complete-detail")).toHaveText(
    "Impact 62 · Efficiency 8",
  );
  // One tap back: the console adopts the settled verdict in place.
  await page.getByRole("button", { name: "Go to operator console" }).click();
  await expect(page).toHaveURL(/\/console/, { timeout: 10000 });
  await expect(page.locator(".console-play .result")).toBeVisible({ timeout: 15000 });
});

test("completion toast closes itself when ignored", async ({ page }) => {
  await withoutTour(page);
  await page.route("**/api/contract", (route) =>
    route.fulfill({
      json: {
        sim_version: "smoke",
        turns: 12,
        prompt_max_words: 200,
        token_budget: 2000,
        turn_token_cap: 400,
        models: [{ id: "demo", kind: "local" }],
      },
    }),
  );
  const result = {
    seed: 1,
    provider: "smoke",
    scores: { impact: 40, efficiency: 6 },
    totals: { tokens_used: 900 },
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
    token_budget: 2000,
  };
  await page.route("**/api/match-stream", (route) => {
    setTimeout(() => {
      void route.fulfill({
        body: `data: ${JSON.stringify({ type: "result", result })}\n\n`,
        contentType: "text/event-stream",
      });
    }, 1500);
  });
  await page.goto("/console?challenge=debut");
  await page.locator("#prompt").fill("Fund housing, hold reserves, answer shocks.");
  await page.getByRole("button", { name: "Run match" }).click();
  await page.getByRole("link", { name: "Ranks" }).first().click();
  await expect(page).toHaveURL(/\/ranks/, { timeout: 10000 });
  const toast = page.getByText("Simulation complete");
  await expect(toast).toBeVisible({ timeout: 15000 });
  // The 7s dwell, plus slack for a loaded runner.
  await expect(toast).toBeHidden({ timeout: 12000 });
});

test("create form simulates a draft without proposing", async ({ page }) => {
  await withoutTour(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("aim-console-mode", "create");
  });
  await page.route("**/api/contract", (route) =>
    route.fulfill({
      json: {
        sim_version: "smoke",
        turns: 12,
        prompt_max_words: 200,
        token_budget: 2000,
        turn_token_cap: 400,
        models: [{ id: "demo", kind: "local" }],
      },
    }),
  );
  await page.route("**/api/proposals", (route) => route.fulfill({ json: [] }));
  await page.goto("/console");
  await page.locator("#proposal-title").fill("Ember finals");
  await page.locator("#proposal-description").fill("Survive the frost parade.");
  // Proposing still wants the full brief; simulating does not.
  await expect(page.getByRole("button", { name: "Propose challenge" })).toBeDisabled();
  const simulate = page.getByRole("button", { name: "Simulate now" });
  await expect(simulate).toBeEnabled();
  await simulate.click();
  // The console flips to play with the local draft armed: title,
  // brief, and a locked rotation-style seed.
  await expect(page.locator(".challenge-card h3")).toHaveText("Ember finals");
  await expect(page.getByText(/Seed locked to/)).toBeVisible();
  // The unproposed draft survives the hop: back in Create, the
  // title is still there, ready to tweak and publish.
  await page.getByRole("button", { name: "Create a challenge instead" }).click();
  await expect(page.locator("#proposal-title")).toHaveValue("Ember finals");
  await expect(page.locator("#proposal-description")).toHaveValue(
    "Survive the frost parade.",
  );
});
