import { describe, expect, it } from "vitest";
import { buildRepositoryModel } from "@/brain/repository-model/build-repository-model";
import { gateScanFindings, validateFindingAgainstRepository } from "@/brain/repository-model/finding-gate";
import {
  isAdapterCompatibleWithFramework,
  validateAdapterPreconditions,
} from "@/brain/repository-model/attack-preconditions";
import { getAttackAdapterById } from "@/server/attack-simulation/planner/adapter-catalog";
import { planScenariosFromHypotheses } from "@/server/attack-simulation/planner/plan-scenarios";
import {
  canTransitionReviewPhase,
  mapScanStatusToReviewPhase,
  reviewPhaseProgressForScan,
} from "@/brain/review-engine/state-machine";
import type { NormalizedFile } from "@/features/security-scanner/types";
import { stubNormalizedFile } from "@/features/security-scanner/normalization";
import { detectStack } from "@/features/security-scanner/stack";
import type { Finding } from "@/features/security-scanner/types";

function filesFromPaths(paths: string[]): NormalizedFile[] {
  return paths.map((path) =>
    stubNormalizedFile(
      path,
      path.includes("route.ts")
        ? "export async function GET() { return Response.json({ ok: true }); }"
        : ""
    )
  );
}

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "auth.missing:test",
    ruleId: "auth.missing",
    fingerprint: "fp",
    title: "Route has no visible authentication",
    description: "test",
    severity: "medium",
    confidence: "low",
    category: "authentication",
    location: { path: "app/api/users/route.ts", line: 1 },
    remediation: "Add auth",
    ...overrides,
  };
}

describe("Review Engine Hardening V2", () => {
  describe("Repository model", () => {
    it("classifies static marketing website without API surface", () => {
      const files = filesFromPaths(["index.html", "styles.css", "app/page.tsx"]);
      const model = buildRepositoryModel(files, detectStack(files));
      expect(model.capabilities.hasApiSurface).toBe(false);
      expect(model.projectType).toMatch(/marketing|landing|unknown/);
    });

    it("detects Next.js API routes", () => {
      const files = filesFromPaths([
        "package.json",
        "app/api/users/route.ts",
        "middleware.ts",
      ]);
      files[0].content = JSON.stringify({ dependencies: { next: "15.0.0" } });
      const model = buildRepositoryModel(files, detectStack(files));
      expect(model.framework).toBe("nextjs");
      expect(model.capabilities.hasApiSurface).toBe(true);
    });

    it("detects Express API-only project", () => {
      const files = filesFromPaths(["package.json", "server/routes/users.ts"]);
      files[0].content = JSON.stringify({ dependencies: { express: "4.18.0" } });
      files[1].content = "router.get('/users', (req, res) => res.json([]));";
      const model = buildRepositoryModel(files, detectStack(files));
      expect(model.capabilities.hasExpressRoutes).toBe(true);
      expect(model.capabilities.hasApiSurface).toBe(true);
    });

    it("detects React SPA without backend", () => {
      const files = filesFromPaths(["package.json", "src/App.tsx", "src/main.tsx"]);
      files[0].content = JSON.stringify({ dependencies: { react: "18.0.0", vite: "5.0.0" } });
      const model = buildRepositoryModel(files, detectStack(files));
      expect(model.capabilities.hasApiSurface).toBe(false);
    });
  });

  describe("Finding gate — no generic auth findings", () => {
    it("discards auth.missing when no API exists", () => {
      const files = filesFromPaths(["index.html", "about.html"]);
      const model = buildRepositoryModel(files, detectStack(files));
      const result = validateFindingAgainstRepository(sampleFinding(), model);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toMatch(/No API|not applicable/i);
      }
    });

    it("discards auth finding on public marketing site", () => {
      const files = filesFromPaths(["app/page.tsx", "components/Hero.tsx", "components/marketing/CTA.tsx"]);
      const model = buildRepositoryModel(files, detectStack(files));
      const { discarded } = gateScanFindings([sampleFinding()], model);
      expect(discarded.length).toBeGreaterThan(0);
    });

    it("accepts auth finding on banking app with API and auth infra", () => {
      const files = filesFromPaths([
        "app/api/accounts/route.ts",
        "middleware.ts",
        "lib/auth/session.ts",
        "app/dashboard/page.tsx",
      ]);
      const model = buildRepositoryModel(files, detectStack(files));
      const result = validateFindingAgainstRepository(
        sampleFinding({ location: { path: "app/api/accounts/route.ts", line: 3 } }),
        model
      );
      expect(result.allowed).toBe(true);
    });

    it("relabels low-confidence findings as potential observations", () => {
      const files = filesFromPaths(["app/api/billing/route.ts", "middleware.ts"]);
      const model = buildRepositoryModel(files, detectStack(files));
      const { accepted } = gateScanFindings(
        [
          sampleFinding({
            confidence: "low",
            location: { path: "app/api/billing/route.ts", line: 2 },
            evidence: "export async function POST",
          }),
        ],
        model
      );
      expect(accepted[0]?.title.startsWith("Potential:")).toBe(true);
    });

    it("discards findings without evidence fields", () => {
      const files = filesFromPaths(["app/api/test/route.ts"]);
      const model = buildRepositoryModel(files, detectStack(files));
      const result = validateFindingAgainstRepository(
        sampleFinding({ location: { path: "", line: 0 }, evidence: undefined }),
        model
      );
      expect(result.allowed).toBe(false);
    });
  });

  describe("Attack preconditions", () => {
    it("skips unauthenticated-endpoint on static site", () => {
      const files = filesFromPaths(["index.html"]);
      const model = buildRepositoryModel(files, detectStack(files));
      const adapter = getAttackAdapterById("unauthenticated-endpoint")!;
      const check = validateAdapterPreconditions(adapter, model);
      expect(check.satisfied).toBe(false);
    });

    it("skips unauthenticated-endpoint on React SPA without backend", () => {
      const files = filesFromPaths(["src/App.tsx"]);
      files[0].content = "export default function App() { return null; }";
      const model = buildRepositoryModel(files, detectStack(files));
      model.framework = "react_spa";
      const adapter = getAttackAdapterById("unauthenticated-endpoint")!;
      const check = isAdapterCompatibleWithFramework(adapter, model);
      expect(check.satisfied).toBe(false);
    });

    it("plans unauthenticated-endpoint only when API exists", () => {
      const files = filesFromPaths(["app/api/users/route.ts"]);
      const model = buildRepositoryModel(files, detectStack(files));
      const result = planScenariosFromHypotheses({
        campaignId: "c1",
        organizationId: "o1",
        projectId: "p1",
        runtimeMode: "mock",
        repositoryModel: model,
        hypotheses: [
          {
            id: "h1",
            source: "red_team",
            category: "authentication",
            title: "Unauthenticated user endpoint",
            description: "Missing auth on users API",
            severity: "high",
            confidence: "medium",
          },
        ],
      });
      expect(result.planned.length).toBe(1);
    });
  });

  describe("Review state machine", () => {
    it("never allows backward transitions", () => {
      expect(canTransitionReviewPhase("STATIC_ANALYSIS", "DISCOVERY")).toBe(false);
      expect(canTransitionReviewPhase("COMPLETED", "QUEUED")).toBe(false);
      expect(canTransitionReviewPhase("PRODUCTION_VERDICT", "RED_TEAM")).toBe(false);
    });

    it("allows forward transitions only", () => {
      expect(canTransitionReviewPhase("QUEUED", "DISCOVERY")).toBe(true);
      expect(canTransitionReviewPhase("DISCOVERY", "STATIC_ANALYSIS")).toBe(true);
      expect(canTransitionReviewPhase("PRODUCTION_VERDICT", "COMPLETED")).toBe(true);
    });

    it("maps scan statuses to monotonic phases", () => {
      expect(mapScanStatusToReviewPhase("fetching_repository")).toBe("DISCOVERY");
      expect(mapScanStatusToReviewPhase("scanning")).toBe("STATIC_ANALYSIS");
      expect(mapScanStatusToReviewPhase("completed")).toBe("COMPLETED");
    });

    it("reports honest progress without exceeding completed", () => {
      const progress = reviewPhaseProgressForScan({
        scanStatus: "scanning",
        progress: 65,
        message: "Running rules",
      });
      expect(progress.percentage).toBeGreaterThan(0);
      expect(progress.percentage).toBeLessThan(100);
      expect(progress.phase).toBe("STATIC_ANALYSIS");
    });
  });
});
