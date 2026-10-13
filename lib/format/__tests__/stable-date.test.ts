import { describe, expect, it } from "vitest";
import { formatStableDate, formatStableDateTime } from "../stable-date";

describe("stable dates (identical on the server and in any browser)", () => {
  it("always UTC, always the same text for the same instant", () => {
    expect(formatStableDateTime("2026-10-09T10:00:00.000Z")).toBe("2026-10-09 10:00 UTC");
    expect(formatStableDateTime("2026-10-09T23:59:59+02:00")).toBe("2026-10-09 21:59 UTC");
    expect(formatStableDate("2026-10-09T23:30:00-05:00")).toBe("2026-10-10");
    expect(formatStableDate(Date.UTC(2026, 0, 1))).toBe("2026-01-01");
  });

  it("does not depend on the process time zone or locale", () => {
    const original = process.env.TZ;
    try {
      for (const tz of ["UTC", "Europe/Madrid", "America/Los_Angeles", "Pacific/Auckland"]) {
        process.env.TZ = tz;
        expect(formatStableDateTime("2026-10-09T10:00:00.000Z")).toBe("2026-10-09 10:00 UTC");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it("missing or invalid values read as a dash, never as 'Invalid Date'", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      expect(formatStableDate(bad)).toBe("—");
      expect(formatStableDateTime(bad)).toBe("—");
    }
  });
});
