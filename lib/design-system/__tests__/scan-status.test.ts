import { describe, expect, it } from "vitest";
import { scanResultStatus } from "../scan-status";

describe("scanResultStatus", () => {
  it("groups the real in-progress backend statuses into a single 'running' state", () => {
    expect(scanResultStatus("fetching_repository")).toBe("running");
    expect(scanResultStatus("indexing")).toBe("running");
    expect(scanResultStatus("scanning")).toBe("running");
    expect(scanResultStatus("calculating_score")).toBe("running");
  });

  it("maps terminal statuses directly", () => {
    expect(scanResultStatus("completed")).toBe("completed");
    expect(scanResultStatus("failed")).toBe("failed");
    expect(scanResultStatus("cancelled")).toBe("cancelled");
    expect(scanResultStatus("cancelling")).toBe("cancelled");
    expect(scanResultStatus("queued")).toBe("queued");
  });

  it("is case-insensitive since the raw column value's casing isn't guaranteed", () => {
    expect(scanResultStatus("COMPLETED")).toBe("completed");
  });
});
