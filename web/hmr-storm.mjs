import { chromium } from "playwright";
import { execSync } from "node:child_process";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.addInitScript(() => {
  window.localStorage.setItem("simulate.tourSeen", "1");
  window.localStorage.setItem("aim-console-mode", "play");
});
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
await page.goto("http://localhost:3000/console?challenge=debut", { waitUntil: "load", timeout: 60000 });
await page.locator("#prompt").waitFor({ timeout: 30000 });
console.log("loaded ok");
// Storm: 13 rapid whitespace saves across touched components (semantics unchanged).
const files = ["app/console/page.tsx", "app/tote-panel.tsx", "lib/pricing.ts", "lib/sim.ts", "lib/match-stream.ts", "app/challenge-aftermath.tsx", "app/turn-inspect.tsx", "app/turn-brief.tsx", "app/analytics-panel.tsx", "app/analytics-dashboard.tsx", "lib/turn-delta.ts", "lib/csv-export.ts", "app/docs-panel.tsx"];
for (const f of files) {
  execSync(`printf '\\n// storm\\n' >> ${f} && sleep 0.4 && git checkout -- ${f} 2>/dev/null || truncate -s -9 ${f}`);
}
// NOTE: git is broken here; fallback truncates the 9 appended bytes. Verify below.
await page.waitForTimeout(8000);
const state = await page.evaluate(() => ({
  prompt: document.querySelector("#prompt") ? "present" : "absent",
  canvas: document.querySelector("canvas.site-bg") ? "present" : "absent",
}));
console.log("state:", JSON.stringify(state), "pageerrors:", errs.length);
for (const e of errs.slice(0, 6)) console.log(" *", e);
try {
  await page.locator("#prompt").fill("storm probe");
  console.log("fill: ALIVE");
} catch { console.log("fill: DEAD"); }
await browser.close();
