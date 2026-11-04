"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { describe, it } = require("node:test");
const launcher = require("./launcher");

describe("findFreePort", () => {
  it("returns the start port when free", async () => {
    const port = await launcher.findFreePort(38923);
    assert.equal(port, 38923);
  });

  it("skips occupied ports", async () => {
    const busy = net.createServer();
    await new Promise((resolve) => busy.listen(38924, "127.0.0.1", resolve));
    try {
      const port = await launcher.findFreePort(38924);
      assert.equal(port, 38925);
    } finally {
      busy.close();
    }
  });

  it("skips ports held by an IPv6 wildcard listener", async () => {
    // `next dev` holds `*` (IPv6 dual-stack): the probe must see that
    // as occupied, or the shell spawns beside it and the window loads
    // the dev server over IPv4 — a stuck gate and dead buttons.
    const busy = net.createServer();
    await new Promise((resolve) => busy.listen(38928, resolve));
    try {
      const port = await launcher.findFreePort(38928);
      assert.equal(port, 38929);
    } finally {
      busy.close();
    }
  });

  it("fails after exhausting the scan window", async () => {
    const busy = net.createServer();
    await new Promise((resolve) => busy.listen(38926, "127.0.0.1", resolve));
    try {
      await assert.rejects(launcher.findFreePort(38926, 1), /no free port/);
    } finally {
      busy.close();
    }
  });
});

describe("paths", () => {
  it("resolves dev paths under the repo root", () => {
    const root = path.resolve("/repo");
    const paths = launcher.devPaths("/repo", "darwin");
    assert.equal(paths.webServer, path.join(root, "web", ".next", "standalone", "server.js"));
    assert.equal(paths.simPython, path.join(root, ".venv", "bin", "python"));
  });

  it("points at Scripts/python.exe on Windows venvs", () => {
    const root = path.resolve("C:\\repo");
    const paths = launcher.devPaths("C:\\repo", "win32");
    assert.equal(paths.simPython, path.join(root, ".venv", "Scripts", "python.exe"));
  });

  it("resolves packaged paths under resources", () => {
    const paths = launcher.prodPaths("/res");
    assert.equal(paths.webServer, path.join("/res", "aim-web", "server.js"));
    assert.equal(paths.simBinary, path.join("/res", "aim-sim", "aim-sim-server"));
  });
});

describe("nodeCmd", () => {
  it("uses PATH in dev on every platform", () => {
    assert.equal(launcher.nodeCmd(true, "/res", "win32"), "node");
    assert.equal(launcher.nodeCmd(true, "/res", "darwin"), "node");
  });

  it("points at the vendored runtime when packaged", () => {
    assert.equal(
      launcher.nodeCmd(false, "/res", "darwin"),
      path.join("/res", "node", "bin", "node"),
    );
    assert.equal(
      launcher.nodeCmd(false, "/res", "win32"),
      path.join("/res", "node", "node.exe"),
    );
  });
});

describe("webEnv", () => {
  it("always points at the local sim and skips blank extras", () => {
    assert.deepEqual(
      launcher.webEnv({ simPort: 8000, laravelUrl: "", simToken: undefined }),
      { SIM_API_URL: "http://127.0.0.1:8000" },
    );
    assert.deepEqual(
      launcher.webEnv({
        simPort: 8001,
        laravelUrl: "https://board.example.com",
        simToken: "s3cret",
      }),
      {
        SIM_API_URL: "http://127.0.0.1:8001",
        LARAVEL_URL: "https://board.example.com",
        SIM_API_TOKEN: "s3cret",
      },
    );
  });
});

describe("resolveBoardUrl", () => {
  it("lets an explicit LARAVEL_URL win everywhere", () => {
    for (const isDev of [true, false]) {
      assert.equal(
        launcher.resolveBoardUrl({ laravelUrl: "https://custom.test", isDev }),
        "https://custom.test",
      );
    }
  });

  it("points packaged builds at production, dev at localhost", () => {
    assert.equal(
      launcher.resolveBoardUrl({ laravelUrl: undefined, isDev: false }),
      "https://board.simulate.damxstudio.com",
    );
    assert.equal(
      launcher.resolveBoardUrl({ laravelUrl: "", isDev: false }),
      "https://board.simulate.damxstudio.com",
    );
    assert.equal(
      launcher.resolveBoardUrl({ laravelUrl: undefined, isDev: true }),
      undefined,
    );
  });
});

describe("spawn specs", () => {
  it("runs the sim from the venv in dev", () => {
    const spec = launcher.simSpawnSpec(launcher.devPaths("/repo"), 8000, true);
    assert.equal(spec.cmd, path.join("/repo", ".venv", "bin", "python"));
    assert.ok(spec.args.includes("aim_sim.api:create_app"));
    assert.ok(spec.args.includes("8000"));
  });

  it("runs the sim sidecar with the port when packaged", () => {
    const spec = launcher.simSpawnSpec(launcher.prodPaths("/res"), 8001, false);
    assert.equal(spec.cmd, path.join("/res", "aim-sim", "aim-sim-server"));
    assert.deepEqual(spec.args, ["8001"]);
  });

  it("serves the standalone web build on PORT", () => {
    const spec = launcher.webSpawnSpec(
      launcher.prodPaths("/res"),
      3000,
      { SIM_API_URL: "http://127.0.0.1:8000" },
      "/res/node/bin/node",
    );
    assert.equal(spec.cmd, "/res/node/bin/node");
    assert.deepEqual(spec.args, [path.join("/res", "aim-web", "server.js")]);
    assert.equal(spec.env.PORT, "3000");
    assert.equal(spec.env.SIM_API_URL, "http://127.0.0.1:8000");
  });
});

describe("waitForHttp", () => {
  it("resolves true once the server answers", async () => {
    const server = http.createServer((_, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise((resolve) => server.listen(38927, "127.0.0.1", resolve));
    try {
      assert.equal(await launcher.waitForHttp("http://127.0.0.1:38927/", 2000), true);
    } finally {
      server.close();
    }
  });

  it("resolves false when nothing listens", async () => {
    assert.equal(await launcher.waitForHttp("http://127.0.0.1:9/", 300), false);
  });
});
