"use strict";

/**
 * Dataset sandbox helpers (main-process, Electron-free so plain node can
 * test them): classify dataset files, validate sandbox ids, and build
 * import manifests. The sandbox rule lives here — every dataset the
 * user picks is COPIED under the app workspace and every run reads
 * that copy, so nothing the app does can overwrite the user's source
 * directory.
 */
const fs = require("node:fs");
const path = require("node:path");

/** Upper bound per import: listing and copy stop here. */
const MAX_DATASET_FILES = 2000;
/** Upper bound per import: the copy aborts past 1 GiB (and cleans up). */
const MAX_DATASET_BYTES = 1024 * 1024 * 1024;

const TABULAR = new Set([".csv", ".tsv"]);
const TEXT = new Set([".txt", ".md", ".markdown", ".json", ".jsonl", ".ndjson", ".yaml", ".yml"]);
const IMAGES = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"]);
const MODELS_3D = new Set([".glb", ".gltf", ".obj", ".fbx", ".usdz"]);

/**
 * Dataset file kind from its extension: tabular (csv/tsv), text
 * (txt/md/json/...), image, model3d (glb/gltf/obj/...), or other.
 * Extension match is case-insensitive; unknown kinds stay usable —
 * the importer never rejects a file for its type.
 */
function classifyFile(filename) {
  const ext = path.extname(String(filename)).toLowerCase();
  if (TABULAR.has(ext)) return "tabular";
  if (TEXT.has(ext)) return "text";
  if (IMAGES.has(ext)) return "image";
  if (MODELS_3D.has(ext)) return "model3d";
  return "other";
}

/**
 * Sandbox import ids are slug-safe ([a-z0-9][a-z0-9-]*): the id becomes
 * a directory name under the workspace, so anything else (slashes,
 * dots, traversal) is rejected before it can touch the filesystem.
 */
function validateImportId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/**
 * Workspace directory for an import id. Throws on an invalid id rather
 * than resolving a path outside the sandbox root.
 */
function sandboxDir(userDataPath, id) {
  if (!validateImportId(id)) {
    throw new Error(`invalid dataset id: ${String(id)}`);
  }
  return path.join(String(userDataPath), "aim-datasets", id);
}

function summarizeFiles(files) {
  const byKind = { tabular: 0, text: 0, image: 0, model3d: 0, other: 0 };
  let bytes = 0;
  for (const file of files) {
    byKind[file.kind] += 1;
    bytes += file.size;
  }
  return { count: files.length, bytes, byKind };
}

/**
 * Import manifest: the sandbox copy's id, the (read-only) source it
 * was copied from, and the classified file list with a summary. Runs
 * receive `root` and must never see `source`.
 */
function buildManifest(id, sourcePath, root, files) {
  return {
    id,
    source: String(sourcePath),
    root: String(root),
    importedAt: new Date().toISOString(),
    files: files.map((file) => ({
      rel: String(file.rel),
      size: file.size,
      kind: classifyFile(file.rel),
    })),
    summary: summarizeFiles(
      files.map((file) => ({ kind: classifyFile(file.rel), size: file.size })),
    ),
  };
}

/**
 * Filesystem-safe import id from a picked folder's basename: slug plus
 * a timestamp so repeat imports of one folder never collide.
 */
function slugifyImportId(basename) {
  const slug = String(basename)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug === "" ? "dataset" : slug}-${Date.now().toString(36)}`;
}

/**
 * Relative file paths under a picked folder, dotfiles and symlinks
 * skipped, capped at MAX_DATASET_FILES. Symlink directories are not
 * descended, so the walk cannot escape the picked root.
 */
function collectDatasetFiles(root, options = {}) {
  const maxFiles = options.maxFiles ?? MAX_DATASET_FILES;
  const files = [];
  const stack = [""];
  while (stack.length > 0 && files.length < maxFiles) {
    const rel = stack.pop();
    const abs = rel === "" ? root : path.join(root, rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const childRel = rel === "" ? entry.name : path.join(rel, entry.name);
      if (entry.isDirectory()) {
        stack.push(childRel);
      } else if (entry.isFile()) {
        files.push(childRel);
        if (files.length >= maxFiles) {
          break;
        }
      }
    }
  }
  return files;
}

/**
 * Copy a picked folder into the sandbox root. Returns [{rel, size}].
 * Aborts past `maxBytes` (default 1 GiB), removing the partial copy
 * so a failed import leaves no debris. Every destination is checked
 * to stay under `root`.
 */
function copyDatasetFiles(source, root, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_DATASET_BYTES;
  const rels = collectDatasetFiles(source, options);
  fs.mkdirSync(root, { recursive: true });
  const files = [];
  let bytes = 0;
  try {
    for (const rel of rels) {
      const from = path.join(source, rel);
      const to = path.join(root, rel);
      const inside = path.relative(root, to);
      if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) {
        throw new Error(`dataset entry escapes the sandbox: ${rel}`);
      }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      const size = fs.statSync(to).size;
      bytes += size;
      if (bytes > maxBytes) {
        throw new Error(
          `dataset exceeds the ${String(maxBytes)} byte import cap`,
        );
      }
      files.push({ rel, size });
    }
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return files;
}

module.exports = {
  MAX_DATASET_FILES,
  MAX_DATASET_BYTES,
  classifyFile,
  validateImportId,
  sandboxDir,
  slugifyImportId,
  collectDatasetFiles,
  copyDatasetFiles,
  buildManifest,
  summarizeFiles,
};
