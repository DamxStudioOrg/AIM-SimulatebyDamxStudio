/**
 * Landing lite-boundary check (`npm run landing:check`).
 *
 * Walks the local import graph rooted at app/page.tsx and fails when any
 * simulation, match, tote, or console module is reachable from the public
 * landing page. Also asserts the landing keeps its required marketing
 * elements (slideshow, download buttons) and the moon brand mark keeps
 * its required home (the site header) so a future edit cannot silently
 * gut the page again.
 *
 * Usage: node scripts/landing-check.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENTRY = "app/page.tsx";

// Path fragments (relative to web/) that must never load on the landing.
const DENY = [
  "app/api/",
  "app/console/",
  "app/account-panel",
  "app/allocation-",
  "app/analytics",
  "app/api-keys-card",
  "app/arena-shell",
  "app/batch-ablation",
  "app/city-3d",
  "app/cost-chip",
  "app/creator-panel",
  "app/demo-match",
  "app/environment-panel",
  "app/field-plan-panel",
  "app/ghost-race",
  "app/iso-city",
  "app/lane-scroll",
  "app/leagues-panel",
  "app/local-sim-card",
  "app/moon-dock",
  "app/moon-stage",
  "app/nav-panel",
  "app/progress-",
  "app/prompt-version",
  "app/prompts-panel",
  "app/ranks-",
  "app/researcher-notes",
  "app/secret-reveal",
  "app/sim-status",
  "app/stage-view-tools",
  "app/task-card",
  "app/tote-",
  "app/tour-",
  "app/turn-",
  "app/use-history",
  "app/use-match",
  "app/use-sim-route",
  "app/use-tote",
  "lib/auth",
  "lib/challenges",
  "lib/direct-sim",
  "lib/history",
  "lib/pricing",
  "lib/sim",
  "lib/vault",
];

const IMPORT_RE =
  /(?:import\s+(?:[^"']*?\sfrom\s+)?|export\s+\*\s+from\s+|import\s*\()\s*["']([^"']+)["']/g;

function resolveLocal(specifier, fromFile) {
  let candidate = null;
  if (specifier.startsWith("@/")) {
    candidate = specifier.slice(2);
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    candidate = path.posix.normalize(
      path.posix.join(path.posix.dirname(fromFile), specifier),
    );
  } else {
    return null; // Bare package import: not part of the local graph.
  }
  if (candidate.endsWith(".css") || candidate.endsWith(".json")) {
    return null;
  }
  for (const ext of ["", ".tsx", ".ts"]) {
    const full = path.join(root, `${candidate}${ext}`);
    try {
      readFileSync(full, "utf8");
      return `${candidate}${ext}`;
    } catch {
      // Try the next extension.
    }
  }
  return null;
}

function localImports(file) {
  const source = readFileSync(path.join(root, file), "utf8");
  const found = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const resolved = resolveLocal(match[1], file);
    if (resolved !== null) {
      found.push(resolved);
    }
  }
  return found;
}

const visited = new Set();
const queue = [ENTRY];
while (queue.length > 0) {
  const file = queue.pop();
  if (visited.has(file)) {
    continue;
  }
  visited.add(file);
  queue.push(...localImports(file));
}

let failed = false;
for (const file of [...visited].sort()) {
  const hit = DENY.find((fragment) => file.includes(fragment));
  if (hit !== undefined) {
    console.error(
      `landing:check: forbidden module reachable: ${file} (matches ${hit})`,
    );
    failed = true;
  }
}

if (!visited.has("app/how-slideshow.tsx")) {
  console.error(
    "landing:check: app/how-slideshow.tsx is not reachable from the landing",
  );
  failed = true;
}

const entrySource = readFileSync(path.join(root, ENTRY), "utf8");
if (!entrySource.includes("PlanetPanel")) {
  console.error(`landing:check: ${ENTRY} is missing required marker: PlanetPanel`);
  failed = true;
}
// The installer buttons live in their own landing module (wired to the
// version endpoint's downloads map): the module must be reachable and
// carry the button marker somewhere in the landing graph.
if (!visited.has("app/download-buttons.tsx")) {
  console.error(
    "landing:check: app/download-buttons.tsx is not reachable from the landing",
  );
  failed = true;
}
let downloadMarked = false;
for (const file of visited) {
  if (readFileSync(path.join(root, file), "utf8").includes("download-btn")) {
    downloadMarked = true;
    break;
  }
}
if (!downloadMarked) {
  console.error(
    "landing:check: landing graph is missing required marker: download-btn",
  );
  failed = true;
}

// The logo brand mark lives in the site header (layout level, outside the
// landing import graph): it must exist exactly there. The old moon face
// is gone everywhere — neither file may reference its markers.
const headerSource = readFileSync(path.join(root, "app/site-header.tsx"), "utf8");
if (!headerSource.includes("brand-mark")) {
  console.error(
    "landing:check: app/site-header.tsx is missing required marker: brand-mark",
  );
  failed = true;
}
for (const marker of ["moon-placeholder", "header-moon"]) {
  if (headerSource.includes(marker)) {
    console.error(
      `landing:check: app/site-header.tsx must not render the moon: ${marker}`,
    );
    failed = true;
  }
  if (entrySource.includes(marker)) {
    console.error(`landing:check: ${ENTRY} must not render the moon: ${marker}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(
  `landing:check: ok (${String(visited.size)} landing modules, no sim imports)`,
);
