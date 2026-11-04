/**
 * Committed visual smoke regression for the two-panel layout.
 *
 * Captures the lite landing (the #hash suffix only varies the URL;
 * the landing has no tab logic) plus the fresh console — which
 * auto-logs-in, so the shot shows the signed-in console home, not
 * the gate — at a fixed viewport with headless Chrome and compares
 * captures against tests/visual/baseline. This is a smoke guard
 * (same dimensions, similar weight), not a pixel diff: it catches
 * layout collapses and missing surfaces, and the PNGs themselves
 * are the reviewable baseline. The gate regressed transparent once
 * while landing-only captures stayed green; its guard now lives in
 * the Playwright suite (sign-out + computed-style contrast probe),
 * which this CLI screenshot cannot drive.
 *
 * Usage: npm run screenshots          (refresh baselines)
 *        npm run screenshots:check    (capture + compare)
 * Env: BASE_URL (default http://localhost:3100), CHROME (binary path)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseUrl = process.env.BASE_URL ?? "http://localhost:3100";
const chrome =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const tabs = ["how", "docs", "ranks", "account"];
// Fresh console home: a clean headless profile auto-logs-in (no tour
// flags), so the signed-in console is what gets captured.
const pages = [{ name: "console-home", url: `${baseUrl}/console` }];
const check = process.argv.includes("--check");
const baselineDir = path.join(root, "tests", "visual", "baseline");
const currentDir = path.join(root, "tests", "visual", "current");
const outDir = check ? currentDir : baselineDir;

if (!existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}; set CHROME to its path.`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

function pngSize(file) {
  const buf = readFileSync(file);
  // PNG IHDR: width/height are big-endian uint32 at bytes 16/20.
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bytes: buf.length,
  };
}

let failed = false;
const shots = [
  ...tabs.map((tab) => ({ name: tab, url: `${baseUrl}/#${tab}` })),
  ...pages,
];
for (const { name, url } of shots) {
  const file = path.join(outDir, `${name}.png`);
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--window-size=1400,1000",
    "--virtual-time-budget=8000",
    `--screenshot=${file}`,
    url,
  ]);
  const shot = pngSize(file);
  console.log(`${name}: ${shot.width}x${shot.height}, ${shot.bytes} bytes`);
  if (check) {
    const baseFile = path.join(baselineDir, `${name}.png`);
    if (!existsSync(baseFile)) {
      console.error(`${name}: no baseline; run npm run screenshots first.`);
      failed = true;
      continue;
    }
    const base = pngSize(baseFile);
    const drift = Math.abs(shot.bytes - base.bytes) / base.bytes;
    if (shot.width !== base.width || shot.height !== base.height || drift > 0.25) {
      console.error(
        `${name}: drift vs baseline (dims ${base.width}x${base.height} -> ${shot.width}x${shot.height}, weight ${(drift * 100).toFixed(1)}%)`,
      );
      failed = true;
    }
  }
}
if (check && !failed) {
  console.log(`visual smoke: ${shots.length} shots within tolerance of baseline`);
}
process.exit(failed ? 1 : 0);
