import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createApiTeamCoordinator,
  createApiSpecialistRegistry,
  createDefaultApiSpecialists,
  dedupeApiFindings,
} from "../index";
import { newApiFinding } from "../findings/api-finding";

describe("API Team load harness", () => {
  it("dedupes 1000 findings without quadratic blowup", () => {
    const base = newApiFinding({
      specialist: "api.cors",
      category: "cors",
      title: "Unsafe CORS",
      founderSummary: "a",
      technicalExplanation: "b",
      route: "/api/users",
      method: "OPTIONS",
      severity: "high",
      confidence: 0.8,
      status: "candidate",
      correlationKeys: [],
      safeFixEligible: true,
      remediationDirection: "fix",
      replayEligible: true,
      provenance: ["runtime"],
    });
    const findings = Array.from({ length: 1000 }, (_, i) =>
      i % 2 === 0 ? base : { ...base, findingId: randomUUID(), title: `Unique ${i}` }
    );
    const started = Date.now();
    const out = dedupeApiFindings(findings);
    expect(Date.now() - started).toBeLessThan(500);
    expect(out.filter((f) => f.status === "duplicate").length).toBeGreaterThan(0);
  });

  it("registers seven default specialists", () => {
    const registry = createApiSpecialistRegistry(createDefaultApiSpecialists());
    expect(registry.listAll()).toHaveLength(7);
    expect(createApiTeamCoordinator({ registry })).toBeTruthy();
  });
});
