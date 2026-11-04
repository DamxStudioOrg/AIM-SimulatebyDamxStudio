"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");
const datasets = require("./datasets");

describe("classifyFile", () => {
  it("classifies tabular, text, image, and 3d kinds", () => {
    assert.equal(datasets.classifyFile("runs.csv"), "tabular");
    assert.equal(datasets.classifyFile("runs.TSV"), "tabular");
    assert.equal(datasets.classifyFile("notes.md"), "text");
    assert.equal(datasets.classifyFile("data.JSONL"), "text");
    assert.equal(datasets.classifyFile("sprite.PNG"), "image");
    assert.equal(datasets.classifyFile("tower.glb"), "model3d");
    assert.equal(datasets.classifyFile("level.obj"), "model3d");
  });

  it("keeps unknown extensions usable as other", () => {
    assert.equal(datasets.classifyFile("archive.zip"), "other");
    assert.equal(datasets.classifyFile("README"), "other");
  });
});

describe("validateImportId", () => {
  it("accepts slugs", () => {
    assert.equal(datasets.validateImportId("city-pack-1"), true);
  });

  it("rejects traversal and odd ids", () => {
    for (const id of ["../escape", "a/b", ".", "", "UPPER", "has space", "a".repeat(70)]) {
      assert.equal(datasets.validateImportId(id), false, id);
    }
    assert.equal(datasets.validateImportId(null), false);
    assert.equal(datasets.validateImportId(undefined), false);
  });
});

describe("sandboxDir", () => {
  it("nests imports under aim-datasets", () => {
    assert.equal(
      datasets.sandboxDir("/data", "pack-1"),
      path.join("/data", "aim-datasets", "pack-1"),
    );
  });

  it("throws instead of resolving outside the root", () => {
    assert.throws(() => datasets.sandboxDir("/data", "../escape"), /invalid dataset id/);
  });
});

describe("buildManifest", () => {
  it("classifies files and summarizes the import", () => {
    const manifest = datasets.buildManifest("pack-1", "/src/pack", "/data/aim-datasets/pack-1", [
      { rel: "runs.csv", size: 100 },
      { rel: "tower.glb", size: 400 },
    ]);
    assert.equal(manifest.id, "pack-1");
    assert.equal(manifest.source, "/src/pack");
    assert.equal(manifest.root, "/data/aim-datasets/pack-1");
    assert.deepEqual(
      manifest.files.map((f) => f.kind),
      ["tabular", "model3d"],
    );
    assert.equal(manifest.summary.count, 2);
    assert.equal(manifest.summary.bytes, 500);
    assert.equal(manifest.summary.byKind.tabular, 1);
    assert.equal(manifest.summary.byKind.model3d, 1);
  });

  it("summarizes an empty import as zeros", () => {
    const manifest = datasets.buildManifest("empty", "/src", "/dst", []);
    assert.equal(manifest.summary.count, 0);
    assert.equal(manifest.summary.bytes, 0);
  });
});

describe("slugifyImportId", () => {
  it("builds valid sandbox ids from folder names", () => {
    for (const id of [
      datasets.slugifyImportId("City Pack 1"),
      datasets.slugifyImportId("!!!"),
      datasets.slugifyImportId(""),
    ]) {
      assert.equal(datasets.validateImportId(id), true, id);
    }
    assert.match(datasets.slugifyImportId("City Pack 1"), /^city-pack-1-[a-z0-9]+$/);
    assert.match(datasets.slugifyImportId("!!!"), /^dataset-[a-z0-9]+$/);
  });
});

describe("collectDatasetFiles", () => {
  it("lists nested files, skipping dotfiles and symlinks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-collect-"));
    try {
      fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(dir, "runs.csv"), "a,b\n");
      fs.writeFileSync(path.join(dir, "sub", "notes.md"), "# hi\n");
      fs.writeFileSync(path.join(dir, ".hidden"), "x");
      fs.symlinkSync(path.join(dir, "runs.csv"), path.join(dir, "link.csv"));
      const found = datasets.collectDatasetFiles(dir).sort();
      assert.deepEqual(found, ["runs.csv", path.join("sub", "notes.md")].sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never descends into symlinked directories", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-collect-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "aim-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), "shh");
      fs.symlinkSync(outside, path.join(dir, "escape"));
      assert.deepEqual(datasets.collectDatasetFiles(dir), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("stops at the file cap", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-collect-"));
    try {
      for (let i = 0; i < 5; i += 1) {
        fs.writeFileSync(path.join(dir, `f${i}.txt`), "x");
      }
      assert.equal(datasets.collectDatasetFiles(dir, { maxFiles: 3 }).length, 3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("copyDatasetFiles", () => {
  it("copies the tree and reports sizes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-copy-"));
    try {
      const source = path.join(dir, "src");
      const root = path.join(dir, "dst");
      fs.mkdirSync(path.join(source, "sub"), { recursive: true });
      fs.writeFileSync(path.join(source, "a.txt"), "0123456789");
      fs.writeFileSync(path.join(source, "sub", "b.txt"), "0123456789");
      const files = datasets.copyDatasetFiles(source, root);
      assert.equal(files.length, 2);
      assert.equal(
        files.reduce((sum, file) => sum + file.size, 0),
        20,
      );
      assert.equal(fs.readFileSync(path.join(root, "sub", "b.txt"), "utf8"), "0123456789");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aborts past the byte cap and removes the partial copy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-copy-"));
    try {
      const source = path.join(dir, "src");
      const root = path.join(dir, "dst");
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, "big.bin"), Buffer.alloc(100));
      assert.throws(
        () => datasets.copyDatasetFiles(source, root, { maxBytes: 10 }),
        /byte import cap/,
      );
      assert.equal(fs.existsSync(root), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
