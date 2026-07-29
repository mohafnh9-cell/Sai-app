import { describe, expect, it, afterEach } from "vitest";
import {
  getInngestConfigStatus,
  INNGEST_NOT_CONFIGURED,
  mapInngestPlanErrorCode,
} from "@/lib/env/inngest-config";

describe("inngest-config", () => {
  const backup = { ...process.env };

  afterEach(() => {
    process.env = { ...backup };
  });

  it("reports missing keys", () => {
    delete process.env.INNGEST_EVENT_KEY;
    delete process.env.INNGEST_SIGNING_KEY;
    const status = getInngestConfigStatus();
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.code).toBe(INNGEST_NOT_CONFIGURED);
      expect(status.missing).toContain("INNGEST_EVENT_KEY");
    }
  });

  it("maps ingest plan code to INNGEST_NOT_CONFIGURED", () => {
    expect(mapInngestPlanErrorCode("INGEST_NOT_CONFIGURED")).toBe(INNGEST_NOT_CONFIGURED);
  });
});
