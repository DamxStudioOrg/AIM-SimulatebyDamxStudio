import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history";
import {
  b64decode,
  b64encode,
  exportProgressBundle,
  isValidUid,
  normalizeProviderKey,
  openProgressBundle,
  parseProgressBundle,
  tokenKeyForModel,
} from "./vault";

describe("vault helpers", () => {
  it("accepts uuid-style arena ids only", () => {
    expect(isValidUid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isValidUid("not-an-id")).toBe(false);
    expect(isValidUid(null)).toBe(false);
    expect(isValidUid("")).toBe(false);
  });

  it("round-trips bytes through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    expect(b64decode(b64encode(bytes))).toEqual(bytes);
    expect(b64decode(b64encode(new Uint8Array([])))).toEqual(new Uint8Array([]));
  });

  it("rejects malformed base64", () => {
    expect(() => b64decode("!!!")).toThrow();
  });

  it("normalizes provider keys", () => {
    expect(normalizeProviderKey("  sk-abc  ")).toBe("sk-abc");
    expect(normalizeProviderKey("   ")).toBeNull();
    expect(normalizeProviderKey("x".repeat(2001))).toBeNull();
    expect(normalizeProviderKey("x".repeat(2000))).toBe("x".repeat(2000));
  });

  it("keys meta models by provider, others by model", () => {
    expect(tokenKeyForModel("meta/Llama-4-Scout")).toBe("meta");
    expect(tokenKeyForModel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(tokenKeyForModel("anthropic/claude-3-5-sonnet")).toBe(
      "anthropic/claude-3-5-sonnet",
    );
    expect(tokenKeyForModel("ollama/llama3.1")).toBe("ollama/llama3.1");
  });
});

describe("progress bundle", () => {
  const uid = "123e4567-e89b-12d3-a456-426614174000";
  const history: HistoryEntry[] = [
    {
      when: "2026-10-27T00:00:00.000Z",
      seed: 1,
      provider: "ollama:llama3.1",
      impact: 50,
      efficiency: 13,
      prompt: "hold reserves",
    },
  ];

  it("round-trips a sealed bundle under its ID", async () => {
    const raw = await exportProgressBundle(uid, history);
    expect(raw).not.toBe("");
    expect(raw).not.toContain("hold reserves");
    const bundle = parseProgressBundle(raw);
    expect(bundle?.version).toBe(2);
    expect(bundle?.uid).toBe(uid);
    if (bundle === null) throw new Error("expected a bundle");
    const opened = await openProgressBundle(bundle, uid);
    expect(opened).toHaveLength(1);
  });

  it("refuses to open under the wrong ID", async () => {
    const raw = await exportProgressBundle(uid, history);
    const bundle = parseProgressBundle(raw);
    if (bundle === null) throw new Error("expected a bundle");
    const other = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(await openProgressBundle(bundle, other)).toBeNull();
  });

  it("rejects garbage, wrong versions, and bad ids", async () => {
    expect(parseProgressBundle("!!!")).toBeNull();
    expect(parseProgressBundle(b64encode(new TextEncoder().encode("{}")))).toBeNull();
    const wrongVersion = { version: 9, uid, exportedAt: "", history: [] };
    expect(
      parseProgressBundle(
        b64encode(new TextEncoder().encode(JSON.stringify(wrongVersion))),
      ),
    ).toBeNull();
    expect(await exportProgressBundle("nope", history)).toBe("");
    const raw = await exportProgressBundle(uid, history);
    expect(parseProgressBundle(raw)).not.toBeNull();
  });

  it("still opens legacy plaintext bundles", async () => {
    const legacy = b64encode(
      new TextEncoder().encode(
        JSON.stringify({ version: 1, uid, exportedAt: "", history }),
      ),
    );
    const bundle = parseProgressBundle(legacy);
    expect(bundle?.version).toBe(1);
    if (bundle === null) throw new Error("expected a bundle");
    expect(await openProgressBundle(bundle, uid)).toHaveLength(1);
  });

  it("filters malformed entries on import", async () => {
    const raw = await exportProgressBundle(uid, [
      ...history,
      { bogus: true } as unknown as HistoryEntry,
    ]);
    const bundle = parseProgressBundle(raw);
    if (bundle === null) throw new Error("expected a bundle");
    expect(await openProgressBundle(bundle, uid)).toHaveLength(1);
  });
});
