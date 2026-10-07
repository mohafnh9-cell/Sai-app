import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Production Journey ("History") route is a supported surface (docs/PRODUCTION_JOURNEY_ROUTE.md).
 * A permanent redirect to the project page made the History tab silently land on Mission Control; this
 * test fails if that redirect comes back or if navigation stops reaching the page.
 */
const config = readFileSync("next.config.mjs", "utf8");

describe("Production Journey route is reachable", () => {
  it("next.config.mjs does not redirect /projects/:id/journey", () => {
    expect(config).not.toMatch(/projects\/:id\/journey/);
  });

  it("the other legacy redirects are untouched", () => {
    expect(config).toMatch(/source:\s*"\/timeline"/);
    expect(config).toMatch(/source:\s*"\/ai-fixes"/);
    expect(config).toMatch(/source:\s*"\/projects\/:id\/scans"/);
  });

  it("the page exists and navigation links to it", () => {
    expect(existsSync("app/(dashboard)/projects/[id]/journey/page.tsx")).toBe(true);
    expect(readFileSync("features/mission-control/components/ProjectWorkflowNav.tsx", "utf8")).toContain("`${base}/journey`");
    expect(readFileSync("features/mission-control/components/MissionControlHistorySection.tsx", "utf8")).toContain("/journey");
  });

  it("the page renders the canonical-posture journey view with the in-progress state", () => {
    const page = readFileSync("app/(dashboard)/projects/[id]/journey/page.tsx", "utf8");
    expect(page).toMatch(/ProductionJourneyView/);
    expect(page).toMatch(/reviewInProgress=\{reviewInProgress\}/);
    expect(page).toMatch(/getProductionReviewState/);
  });

  it("the journey is built from verdicts through the canonical posture (not raw status)", () => {
    expect(readFileSync("brain/production-journey/build.ts", "utf8")).toMatch(/deploymentPostureOf\(record\.verdict\)/);
    expect(readFileSync("brain/production-journey/maturity.ts", "utf8")).toMatch(/currentPosture === "ready"/);
  });
});
