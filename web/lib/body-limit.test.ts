import { describe, expect, it } from "vitest";
import { MAX_JSON_BODY_BYTES, bodyTooLarge, jsonTooLarge } from "./body-limit";

describe("bodyTooLarge", () => {
  it("rejects declared bodies over the cap", () => {
    const headers = new Headers({
      "content-length": String(MAX_JSON_BODY_BYTES + 1),
    });
    expect(bodyTooLarge(headers)).toBe(true);
  });

  it("accepts declared bodies within the cap", () => {
    const headers = new Headers({ "content-length": "128" });
    expect(bodyTooLarge(headers)).toBe(false);
  });

  it("accepts missing or unreadable lengths and lets the parsed check decide", () => {
    expect(bodyTooLarge(new Headers())).toBe(false);
    expect(bodyTooLarge(new Headers({ "content-length": "many" }))).toBe(false);
  });
});

describe("jsonTooLarge", () => {
  it("rejects parsed bodies over the cap", () => {
    expect(jsonTooLarge({ blob: "x".repeat(MAX_JSON_BODY_BYTES) })).toBe(true);
  });

  it("accepts small parsed bodies", () => {
    expect(jsonTooLarge({ prompt: "Hold reserves." })).toBe(false);
  });
});
