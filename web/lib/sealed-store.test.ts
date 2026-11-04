import { beforeEach, describe, expect, it } from "vitest";
import {
  deviceSalt,
  loadSealedText,
  resealStores,
  sealText,
  type StorageLike,
} from "./sealed-store";

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function fakeStore(entries: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("sealed-store", () => {
  let store: StorageLike;
  beforeEach(() => {
    store = fakeStore();
  });

  it("round-trips text under the same ID", async () => {
    await sealText(store, "k", UID, "hello progress");
    const read = await loadSealedText(store, "k", UID);
    expect(read).toEqual({ text: "hello progress", migrated: false });
    expect(store.getItem("k")).not.toContain("hello progress");
  });

  it("keeps one stable salt per store", () => {
    expect(deviceSalt(store)).toBe(deviceSalt(store));
  });

  it("refuses to open under another ID without touching the bytes", async () => {
    await sealText(store, "k", UID, "secret");
    const raw = store.getItem("k");
    const read = await loadSealedText(store, "k", OTHER);
    expect(read).toEqual({ text: null, migrated: false });
    expect(store.getItem("k")).toBe(raw);
  });

  it("reads null on missing, corrupt, and tampered values", async () => {
    expect(await loadSealedText(store, "missing", UID)).toEqual({
      text: null,
      migrated: false,
    });
    store.setItem("bad", "{nope");
    expect(await loadSealedText(store, "bad", UID)).toEqual({
      text: null,
      migrated: false,
    });
    await sealText(store, "t", UID, "x");
    const raw = store.getItem("t") ?? "";
    store.setItem("t", `${raw.slice(0, -4)}AAAA`);
    expect(await loadSealedText(store, "t", UID)).toEqual({
      text: null,
      migrated: false,
    });
  });

  it("migrates legacy plaintext to sealed on first read", async () => {
    store.setItem("k", JSON.stringify([{ when: "then" }]));
    const read = await loadSealedText(store, "k", UID);
    expect(read.migrated).toBe(true);
    expect(read.text).toBe(JSON.stringify([{ when: "then" }]));
    const again = await loadSealedText(store, "k", UID);
    expect(again).toEqual({ text: read.text, migrated: false });
  });

  it("reseals adopted IDs and skips keys it cannot open", async () => {
    await sealText(store, "a", UID, "one");
    store.setItem("b", JSON.stringify({ legacy: true }));
    await sealText(store, "c", OTHER, "stranger");
    await resealStores(store, ["a", "b", "c"], UID, OTHER);
    expect(await loadSealedText(store, "a", OTHER)).toEqual({
      text: "one",
      migrated: false,
    });
    expect(await loadSealedText(store, "a", UID)).toEqual({
      text: null,
      migrated: false,
    });
    expect((await loadSealedText(store, "b", OTHER)).text).toBe(
      JSON.stringify({ legacy: true }),
    );
    // Sealed under OTHER already: reseal from UID could not open it,
    // so it stays exactly as it was — still readable under OTHER.
    expect((await loadSealedText(store, "c", OTHER)).text).toBe("stranger");
  });

  it("reseal is a no-op across identical IDs", async () => {
    await sealText(store, "a", UID, "one");
    const raw = store.getItem("a");
    await resealStores(store, ["a"], UID, UID);
    expect(store.getItem("a")).toBe(raw);
  });
});
