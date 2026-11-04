import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeBotNickname,
  normalizeDisplayName,
  parseAuthState,
  readBotNickname,
} from "./auth";

describe("parseAuthState", () => {
  it("auto-logs-in on first run when nothing is stored", () => {
    expect(parseAuthState({ guest: null, signedOut: null })).toBe("guest");
  });

  it("is guest when the guest flag is stored", () => {
    expect(parseAuthState({ guest: "1", signedOut: null })).toBe("guest");
  });

  it("is signed out only after an explicit logout", () => {
    expect(parseAuthState({ guest: null, signedOut: "1" })).toBe("signed-out");
  });

  it("prefers the guest flag over a stale logout flag", () => {
    expect(parseAuthState({ guest: "1", signedOut: "1" })).toBe("guest");
  });

  it("ignores unexpected stored values", () => {
    expect(parseAuthState({ guest: "0", signedOut: null })).toBe("guest");
    expect(parseAuthState({ guest: "0", signedOut: "1" })).toBe("signed-out");
  });
});

describe("normalizeDisplayName", () => {
  it("trims surrounding space", () => {
    expect(normalizeDisplayName("  Maya  ")).toBe("Maya");
  });

  it("treats blank input as unset", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
  });

  it("caps names at 24 characters", () => {
    expect(normalizeDisplayName("abcdefghijklmnopqrstuvwxyz")).toBe(
      "abcdefghijklmnopqrstuvwx",
    );
  });
});

describe("readBotNickname", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads and normalizes the stored nickname", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "  Rusty  " } });
    expect(readBotNickname()).toBe("Rusty");
  });

  it("is null without a window or value", () => {
    expect(readBotNickname()).toBeNull();
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    expect(readBotNickname()).toBeNull();
  });
});

describe("normalizeBotNickname", () => {
  it("trims surrounding space", () => {
    expect(normalizeBotNickname("  Rusty  ")).toBe("Rusty");
  });

  it("treats blank input as unset", () => {
    expect(normalizeBotNickname("")).toBeNull();
  });

  it("caps nicknames at 24 characters", () => {
    expect(normalizeBotNickname("abcdefghijklmnopqrstuvwxyz")).toBe(
      "abcdefghijklmnopqrstuvwx",
    );
  });
});
