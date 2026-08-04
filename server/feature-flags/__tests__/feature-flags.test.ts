import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isFeatureEnabled } from "../index";

describe("feature flags", () => {
  const prevBeta = process.env.SEQURAI_BETA_ORG_IDS;

  beforeEach(() => {
    process.env.SEQURAI_BETA_ORG_IDS = "org-beta";
  });

  afterEach(() => {
    process.env.SEQURAI_BETA_ORG_IDS = prevBeta;
  });

  it("denies private_beta without organization context", () => {
    expect(isFeatureEnabled("inngest_scheduler")).toBe(false);
  });

  it("allows private_beta for allowlisted org", () => {
    expect(isFeatureEnabled("inngest_scheduler", { organizationId: "org-beta" })).toBe(true);
  });

  it("always allows GA flags", () => {
    expect(isFeatureEnabled("mcp_enrichment", { organizationId: "any" })).toBe(true);
    expect(isFeatureEnabled("analysis_run_isolation", { organizationId: "any" })).toBe(true);
  });
});
