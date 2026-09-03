import { describe, expect, it } from "vitest";
import { formatDurationCompact } from "../duration";

describe("formatDurationCompact", () => {
  it("formats sub-minute durations as seconds", () => {
    expect(formatDurationCompact(2000)).toBe("2s");
    expect(formatDurationCompact(500)).toBe("1s");
  });

  it("formats minute-scale durations as 'Xm Ys'", () => {
    expect(formatDurationCompact(78_000)).toBe("1m 18s");
    expect(formatDurationCompact(60_000)).toBe("1m");
  });

  it("does not fabricate a duration for missing or invalid input", () => {
    expect(formatDurationCompact(null)).toBeNull();
    expect(formatDurationCompact(undefined)).toBeNull();
    expect(formatDurationCompact(-5)).toBeNull();
    expect(formatDurationCompact(Number.NaN)).toBeNull();
  });
});
