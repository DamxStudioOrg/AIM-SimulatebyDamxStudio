"use strict";
/* Simulate by Damx Studio desktop shell: boots the local sim + web console, then shows them. */
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("node:fs");
const launcher = require("./lib/launcher");
const datasets = require("./lib/datasets");
const storeHealth = require("./lib/store-health");

/* Runtime app name: the macOS menu bar, About panel, and dock derive
   from app.getName() (package.json `name`), NOT from the builder's
   productName, so without this the app reads "aim-arena-desktop".
   The userData dir keeps its legacy path so sealed progress and
   sandboxed datasets survive the rename. */
const legacyUserData = app.getPath("userData");
app.setName("Simulate by Damx Studio");
app.setPath("userData", legacyUserData);
app.setAboutPanelOptions({
  applicationName: "Simulate by Damx Studio",
  applicationVersion: app.getVersion(),
  copyright: "Damx Studio LTD.",
  version: app.getVersion(),
});

const children = new Set();

function track(child, label) {
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.on("error", (error) => {
    dialog.showErrorBox(`${label} failed to start`, String(error));
  });
  return child;
}

function stopAll() {
  for (const child of children) {
    child.kill();
  }
}

async function boot() {
  const locked = app.requestSingleInstanceLock();
  if (!locked) {
    app.quit();
    return;
  }
  const isDev = !app.isPackaged;
  // A broken profile shows up as a dead sign-in button and a flat
  // backdrop (localStorage and the GPU cache both live here). Warn
  // honestly, but keep booting: the console works in memory.
  const storeDir = app.getPath("userData");
  if (
    !storeHealth.userDataWritable(storeDir) ||
    !storeHealth.userDataRoundTrip(storeDir)
  ) {
    dialog.showErrorBox(
      "Simulate by Damx Studio",
      `Local storage is not writable at ${storeDir}. Sessions will not be saved; ` +
        "quit the app, rename that folder, and relaunch to start fresh.",
    );
  }
  const paths = isDev
    ? launcher.devPaths(path.resolve(app.getAppPath(), "..", ".."))
    : launcher.prodPaths(process.resourcesPath);

  const simPort = await launcher.findFreePort(launcher.DEFAULT_SIM_PORT);
  const webPort = await launcher.findFreePort(launcher.DEFAULT_WEB_PORT);

  const sim = launcher.simSpawnSpec(paths, simPort, isDev);
  track(
    spawn(sim.cmd, sim.args, { cwd: sim.cwd, stdio: "ignore", windowsHide: true }),
    "sim",
  );
  const simReady = await launcher.waitForHttp(
    `${launcher.simUrl(simPort)}/contract`,
  );
  if (!simReady) {
    dialog.showErrorBox(
      "Simulate by Damx Studio",
      "The local sim did not start in time.",
    );
    app.quit();
    return;
  }

  const web = launcher.webSpawnSpec(
    paths,
    webPort,
    launcher.webEnv({
      simPort,
      laravelUrl: launcher.resolveBoardUrl({
        laravelUrl: process.env.LARAVEL_URL,
        isDev,
      }),
      simToken: process.env.SIM_API_TOKEN,
    }),
    launcher.nodeCmd(isDev, process.resourcesPath),
  );
  track(
    spawn(web.cmd, web.args, {
      cwd: web.cwd,
      env: web.env,
      stdio: "ignore",
      windowsHide: true,
    }),
    "web",
  );
  const webReady = await launcher.waitForHttp(
    `http://127.0.0.1:${webPort}/`,
  );
  if (!webReady) {
    dialog.showErrorBox(
      "Simulate by Damx Studio",
      "The local console did not start in time.",
    );
    app.quit();
    return;
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: "#150606",
    title: "Simulate by Damx Studio",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  registerDatasetHandlers(window);
  guardNavigation(window, webPort);
  window.once("ready-to-show", () => window.show());
  await window.loadURL(`http://127.0.0.1:${webPort}/console`);
}

/**
 * The window shows the local console and nothing else: in-app moves
 * stay on the loopback origin, https links (share, downloads) open
 * in the real browser, and everything else (including new windows
 * and webviews) is denied.
 */
function guardNavigation(window, webPort) {
  const allowedOrigin = `http://127.0.0.1:${webPort}`;
  const isLocal = (url) =>
    url === allowedOrigin || url.startsWith(`${allowedOrigin}/`);
  const openExternalHttps = (url) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
  };
  window.webContents.on("will-navigate", (event, url) => {
    if (isLocal(url)) {
      return;
    }
    event.preventDefault();
    openExternalHttps(url);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttps(url);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

/**
 * Dataset sandbox IPC: pick a folder with the native dialog, copy it
 * into the app workspace, and serve manifests from the copy. The
 * source directory is only ever read; every write lands under
 * userData/aim-datasets/<id>, so runs cannot overwrite user data.
 * Import is dialog-linked: the renderer cannot name a path — it can
 * only import the folder the dialog just returned, one-shot.
 */
function registerDatasetHandlers(window) {
  const sandboxRoot = () => path.join(app.getPath("userData"), "aim-datasets");
  let pendingPick = null;

  ipcMain.handle("datasets:pick", async () => {
    const picked = await dialog.showOpenDialog(window, {
      title: "Select a dataset folder",
      properties: ["openDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      pendingPick = null;
      return null;
    }
    pendingPick = picked.filePaths[0];
    return pendingPick;
  });

  ipcMain.handle("datasets:import", () => {
    const sourcePath = pendingPick;
    pendingPick = null;
    if (typeof sourcePath !== "string" || sourcePath === "") {
      throw new Error("pick a dataset folder before importing");
    }
    let stat;
    try {
      stat = fs.statSync(sourcePath);
    } catch {
      throw new Error("the picked folder is gone; pick it again");
    }
    if (!stat.isDirectory()) {
      throw new Error("dataset source must be a directory");
    }
    const id = datasets.slugifyImportId(path.basename(sourcePath));
    const root = datasets.sandboxDir(sandboxRoot(), id);
    const files = datasets.copyDatasetFiles(sourcePath, root);
    const manifest = datasets.buildManifest(id, sourcePath, root, files);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    return manifest;
  });

  ipcMain.handle("datasets:get", (_event, id) => {
    const root = datasets.sandboxDir(sandboxRoot(), String(id));
    return JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  });

  ipcMain.handle("datasets:remove", (_event, id) => {
    const root = datasets.sandboxDir(sandboxRoot(), String(id));
    fs.rmSync(root, { recursive: true, force: true });
    return true;
  });

  ipcMain.handle("app:version", () => app.getVersion());
}

app.on("window-all-closed", () => {
  stopAll();
  app.quit();
});

app.on("will-quit", stopAll);

app.whenReady().then(boot, (error) => {
  dialog.showErrorBox(
    "Simulate by Damx Studio failed to start",
    String(error),
  );
  app.quit();
});
