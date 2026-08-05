import { describe, expect, it } from "vitest";
import { assertRscSerializable, toRscSafe } from "@/lib/rsc/to-rsc-safe";

describe("toRscSafe", () => {
  it("removes undefined keys at every depth", () => {
    const input = {
      a: 1,
      b: undefined,
      nested: {
        keep: "yes",
        drop: undefined,
        list: [{ ok: true, missing: undefined }],
      },
    };

    const safe = toRscSafe(input);
    expect(safe).toEqual({
      a: 1,
      nested: {
        keep: "yes",
        list: [{ ok: true }],
      },
    });
    expect(JSON.stringify(safe)).not.toContain("undefined");
    assertRscSerializable(safe);
  });

  it("preserves null values", () => {
    const safe = toRscSafe({ score: null, label: "x" });
    expect(safe).toEqual({ score: null, label: "x" });
    assertRscSerializable(safe);
  });

  it("converts Date objects to ISO strings", () => {
    const date = new Date("2026-08-05T07:00:00.000Z");
    const safe = toRscSafe({ at: date });
    expect(safe).toEqual({ at: "2026-08-05T07:00:00.000Z" });
    assertRscSerializable(safe);
  });
});
