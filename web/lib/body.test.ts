import { describe, expect, it } from "vitest";
import { allocationField, intField, numberField, recordOf, stringField } from "./body";

describe("body validators", () => {
  it("narrows records and rejects arrays and scalars", () => {
    expect(recordOf({ a: 1 })).toEqual({ a: 1 });
    expect(recordOf([1])).toBeNull();
    expect(recordOf("x")).toBeNull();
    expect(recordOf(null)).toBeNull();
  });

  it("validates string fields with blank and length rules", () => {
    const rec = { name: "ok", blank: "  ", long: "abcdef" };
    expect(stringField(rec, "name", 4)).toBe("ok");
    expect(stringField(rec, "blank", 4)).toBeNull();
    expect(stringField(rec, "long", 4)).toBeNull();
    expect(stringField(rec, "missing", 4)).toBeNull();
  });

  it("validates int ranges and finite numbers", () => {
    const rec = { turn: 5, ratio: 1.5, bad: Number.NaN };
    expect(intField(rec, "turn", 1, 12)).toBe(5);
    expect(intField(rec, "turn", 6, 12)).toBeNull();
    expect(intField(rec, "ratio", 0, 9)).toBeNull();
    expect(numberField(rec, "ratio")).toBe(1.5);
    expect(numberField(rec, "bad")).toBeNull();
  });

  it("validates allocation shapes", () => {
    const rec = { alloc: { rescue: 10, housing: 5 }, bad: { rescue: "x" } };
    expect(allocationField(rec, "alloc")).toEqual({ rescue: 10, housing: 5 });
    expect(allocationField(rec, "bad")).toBeNull();
  });
});
