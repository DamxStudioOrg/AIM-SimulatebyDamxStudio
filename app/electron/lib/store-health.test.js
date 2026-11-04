"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { userDataRoundTrip, userDataWritable } = require("./store-health");

describe("store-health", () => {
  it("passes a writable dir and round-trips a probe file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-store-"));
    assert.equal(userDataWritable(dir), true);
    assert.equal(userDataRoundTrip(dir), true);
    assert.equal(fs.existsSync(path.join(dir, ".aim-write-probe")), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates a missing dir", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aim-store-")), "sub");
    assert.equal(userDataWritable(dir), true);
    assert.equal(fs.existsSync(dir), true);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  });

  it("fails a file masquerading as the dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aim-store-"));
    const file = path.join(dir, "blocker");
    fs.writeFileSync(file, "x");
    assert.equal(userDataWritable(file), false);
    assert.equal(userDataRoundTrip(file), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
