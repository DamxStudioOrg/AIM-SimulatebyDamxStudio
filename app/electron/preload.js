"use strict";

/**
 * Preload bridge: exposes the dataset sandbox to the console renderer
 * through contextIsolation-safe IPC. The renderer never touches the
 * filesystem or dialog modules directly — every call crosses
 * ipcRenderer.invoke to a validated main-process handler.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("SimulatebyDamxStudio", {
  /** Running shell version (package.json). Resolves to e.g. "0.1.0". */
  getVersion: () => ipcRenderer.invoke("app:version"),
  datasets: {
    /** Native folder picker. Resolves to the chosen path or null. */
    pick: () => ipcRenderer.invoke("datasets:pick"),
    /**
     * Copy the dialog-picked folder into the sandbox. Takes no path:
     * main imports the folder the dialog just returned, one-shot.
     * Resolves to the import manifest.
     */
    import: () => ipcRenderer.invoke("datasets:import"),
    /** Read a sandboxed import's manifest by id. */
    get: (id) => ipcRenderer.invoke("datasets:get", id),
    /** Delete a sandboxed import (workspace copy only, never the source). */
    remove: (id) => ipcRenderer.invoke("datasets:remove", id),
  },
});
