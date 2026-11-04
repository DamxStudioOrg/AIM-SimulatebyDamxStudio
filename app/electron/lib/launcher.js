"use strict";
/**
 * Desktop launcher logic: ports, paths, spawn specs, readiness.
 * Electron-free so `node --test` covers it without a display.
 */
const net = require("node:net");
const path = require("node:path");

const DEFAULT_SIM_PORT = 8000;
const DEFAULT_WEB_PORT = 3000;
/** Production board: ranks, votes, proposals, installer links. */
const DEFAULT_BOARD_URL = "https://board.simulate.damxstudio.com";
const PORT_SCAN_TRIES = 20;
const READY_TIMEOUT_MS = 45000;
const READY_POLL_MS = 500;

/** Bind-probe one leg: null when the port is free there, the error if not. */
function probeBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve(error));
    server.once("listening", () => server.close(() => resolve(null)));
    server.listen(port, host);
  });
}

/** True when the v6 leg failed for want of a stack, not a holder. */
function noIpv6Stack(error) {
  return (
    error !== null &&
    (error.code === "EAFNOSUPPORT" ||
      error.code === "ENOSYS" ||
      error.code === "EADDRNOTAVAIL")
  );
}

/**
 * True only when neither stack holds the port. An IPv4-only probe
 * lies on macOS: `next dev` holds IPv6 `*` yet a 127.0.0.1 bind
 * still succeeds, so the shell used to spawn beside the dev server
 * and the window loaded it over IPv4 — a stuck gate, dead buttons.
 */
async function portFree(port) {
  const v4 = await probeBind(port, "127.0.0.1");
  if (v4 !== null) {
    return false;
  }
  const v6 = await probeBind(port, "::");
  if (v6 === null || noIpv6Stack(v6)) {
    return true;
  }
  return false;
}

/** First free loopback port at or after `start`, either stack counts. */
async function findFreePort(start, tries = PORT_SCAN_TRIES) {
  let port = start;
  for (let attempts = 0; attempts < tries; attempts += 1) {
    // Serial on purpose: each probe binds, so parallel probes race.
    if (await portFree(port)) {
      return port;
    }
    port += 1;
  }
  throw new Error(`no free port near ${start}`);
}

/** Dev paths from the workspace root (web/, app/sim/, .venv/). */
function devPaths(repoRoot, platform = process.platform) {
  const projectRoot = path.resolve(repoRoot);
  // Windows venvs keep the interpreter under Scripts, POSIX under bin.
  const simPython =
    platform === "win32"
      ? path.join(projectRoot, ".venv", "Scripts", "python.exe")
      : path.join(projectRoot, ".venv", "bin", "python");
  return {
    webDir: path.join(projectRoot, "web"),
    webServer: path.join(projectRoot, "web", ".next", "standalone", "server.js"),
    simPython,
    simWorkdir: path.join(projectRoot, "app", "sim"),
  };
}

/** Packaged paths inside Electron resources. */
function prodPaths(resourcesPath) {
  return {
    webDir: path.join(resourcesPath, "aim-web"),
    webServer: path.join(resourcesPath, "aim-web", "server.js"),
    simBinary: path.join(resourcesPath, "aim-sim", "aim-sim-server"),
  };
}

function simUrl(simPort) {
  return `http://127.0.0.1:${simPort}`;
}

/**
 * Board URL for the web child: an explicit LARAVEL_URL always wins;
 * packaged builds fall back to the production board so installed apps
 * are live on first launch; dev keeps the local default (unset here
 * means the web server's own localhost fallback).
 */
function resolveBoardUrl({ laravelUrl, isDev }) {
  if (laravelUrl !== undefined && laravelUrl !== "") {
    return laravelUrl;
  }
  if (isDev) {
    return undefined;
  }
  return DEFAULT_BOARD_URL;
}

/** Env the shell injects into the web server child. */
function webEnv({ simPort, laravelUrl, simToken }) {
  const env = { SIM_API_URL: simUrl(simPort) };
  if (laravelUrl !== undefined && laravelUrl !== "") {
    env.LARAVEL_URL = laravelUrl;
  }
  if (simToken !== undefined && simToken !== "") {
    env.SIM_API_TOKEN = simToken;
  }
  return env;
}

/** How to spawn the sim: dev uses the repo venv, prod the sidecar. */
function simSpawnSpec(paths, port, isDev) {
  if (isDev) {
    return {
      cmd: paths.simPython,
      args: [
        "-m",
        "uvicorn",
        "aim_sim.api:create_app",
        "--factory",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      cwd: paths.simWorkdir,
    };
  }
  return { cmd: paths.simBinary, args: [String(port)], cwd: undefined };
}

/**
 * Node executable: dev uses PATH, packaged builds use the vendored
 * runtime (process.execPath under Electron is the shell, not Node).
 */
function nodeCmd(isDev, resourcesPath, platform = process.platform) {
  if (isDev) {
    return "node";
  }
  if (platform === "win32") {
    return path.join(resourcesPath, "node", "node.exe");
  }
  return path.join(resourcesPath, "node", "bin", "node");
}

/** How to spawn the web server (Next standalone in both modes). */
function webSpawnSpec(paths, port, extraEnv, node) {
  return {
    cmd: node,
    args: [paths.webServer],
    cwd: paths.webDir,
    env: { ...process.env, PORT: String(port), ...extraEnv },
  };
}

/** True once GET url answers (any status) before the timeout. */
async function waitForHttp(url, timeoutMs = READY_TIMEOUT_MS) {
  const started = Date.now();
  for (;;) {
    try {
      await fetch(url);
      return true;
    } catch {
      if (Date.now() - started > timeoutMs) {
        return false;
      }
      await new Promise((r) => setTimeout(r, READY_POLL_MS));
    }
  }
}

module.exports = {
  DEFAULT_SIM_PORT,
  DEFAULT_WEB_PORT,
  DEFAULT_BOARD_URL,
  resolveBoardUrl,
  PORT_SCAN_TRIES,
  READY_TIMEOUT_MS,
  findFreePort,
  devPaths,
  prodPaths,
  simUrl,
  nodeCmd,
  webEnv,
  simSpawnSpec,
  webSpawnSpec,
  waitForHttp,
};
