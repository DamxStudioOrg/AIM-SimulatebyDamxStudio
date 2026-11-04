"use strict";
/**
 * Store health: the renderer keeps sessions in localStorage, which
 * lives under the app userData dir. A broken profile (unwritable
 * dir, wedged LevelDB/GPU cache) shows up as a dead sign-in button
 * and a flat backdrop — warn honestly at boot instead of failing
 * silently. Never quits: the console still works in memory.
 */
const fs = require("node:fs");
const path = require("node:path");

/** True when the dir exists (or can be created) and accepts writes. */
function userDataWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Writable probe file round-trip: catches quota and lock failures. */
function userDataRoundTrip(dir) {
  try {
    const probe = path.join(dir, ".aim-write-probe");
    fs.writeFileSync(probe, "1");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

module.exports = { userDataWritable, userDataRoundTrip };
