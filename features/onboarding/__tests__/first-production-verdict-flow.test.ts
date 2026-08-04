import { describe, expect, it } from "vitest";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import {
  type OnboardingContext,
  PROGRESS_STEPS,
  parseLegacyStepParam,
  parseWizardStep,
  resolveInitialWizardStep,
  resolveOnboardingProjectId,
  resolveProgressIndex,
  scanIsActive,
  scanIsCompleted,
  shouldSkipGitHubStep,
} from "@/features/onboarding/onboarding-flow";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SCAN = "22222222-2222-4222-8222-222222222222";

function baseContext(overrides: Partial<OnboardingContext> = {}): OnboardingContext {
  return {
    hasOrg: true,
    orgId: "org-1",
    githubConnected: false,
    projects: [],
    activeScan: null,
    latestCompletedScan: null,
    latestVerdict: null,
    isComplete: false,
    ...overrides,
  };
}

describe("Block 6.4 First Production Verdict onboarding flow", () => {
  it("starts at welcome when user has no organization", () => {
    expect(resolveInitialWizardStep(baseContext({ hasOrg: false }))).toBe("welcome");
  });

  it("starts at github when org exists but GitHub is not connected", () => {
    expect(resolveInitialWizardStep(baseContext())).toBe("github");
  });

  it("starts at repository when GitHub is connected but no projects", () => {
    expect(resolveInitialWizardStep(baseContext({ githubConnected: true }))).toBe("repository");
  });

  it("starts at review when project exists without completed verdict", () => {
    expect(
      resolveInitialWizardStep(
        baseContext({
          githubConnected: true,
          projects: [
            {
              id: PROJECT,
              name: "demo",
              githubRepo: "https://github.com/acme/demo",
              defaultBranch: "main",
              isPrivate: false,
              updatedAt: new Date().toISOString(),
            },
          ],
        })
      )
    ).toBe("review");
  });

  it("starts at finale when completed scan and verdict exist during first run", () => {
    const { verdict } = generateProductionVerdict({
      projectId: PROJECT,
      repositoryId: PROJECT,
      scanId: SCAN,
      commitSha: "abc",
      branch: "main",
      scanStatus: "completed",
      securityScore: 64,
      filesAnalyzed: 120,
      filesDiscovered: 150,
      findings: [
        {
          id: "f1",
          title: "Exposed secret",
          severity: "critical",
          category: "security",
          rule_id: "secret",
          file_path: "src/env.ts",
          recommendation: "Remove secret",
          confidence: "high",
        },
      ],
      previousScore: null,
      previousBlockersCount: 0,
    });

    expect(
      resolveInitialWizardStep(
        baseContext({
          githubConnected: true,
          projects: [
            {
              id: PROJECT,
              name: "demo",
              githubRepo: "https://github.com/acme/demo",
              defaultBranch: "main",
              isPrivate: false,
              updatedAt: new Date().toISOString(),
            },
          ],
          latestCompletedScan: {
            id: SCAN,
            projectId: PROJECT,
            status: "completed",
            progress: 100,
            progressMessage: null,
          },
          latestVerdict: verdict,
        })
      )
    ).toBe("finale");
  });

  it("redirect target is cursor when onboarding wizard is complete", () => {
    expect(resolveInitialWizardStep(baseContext({ isComplete: true }))).toBe("cursor");
  });

  it("skips GitHub step when already connected", () => {
    expect(shouldSkipGitHubStep({ githubConnected: true })).toBe(true);
    expect(shouldSkipGitHubStep({ githubConnected: false })).toBe(false);
  });

  it("parses wizard and legacy step params", () => {
    expect(parseWizardStep("review")).toBe("review");
    expect(parseWizardStep("invalid")).toBeNull();
    expect(parseLegacyStepParam("2")).toBe("repository");
    expect(parseLegacyStepParam("4")).toBe("finale");
    expect(parseLegacyStepParam("5")).toBe("cursor");
  });

  it("detects active and completed scan statuses", () => {
    expect(scanIsActive("SCANNING")).toBe(true);
    expect(scanIsActive("completed")).toBe(false);
    expect(scanIsCompleted("completed")).toBe(true);
    expect(scanIsCompleted("SCANNING")).toBe(false);
  });

  it("tracks progress index across wizard steps", () => {
    const ctx = baseContext({ githubConnected: true });
    expect(resolveProgressIndex("github", ctx)).toBe(1);
    expect(resolveProgressIndex("repository", ctx)).toBe(1);
    expect(resolveProgressIndex("review", ctx)).toBe(2);
    expect(resolveProgressIndex("finale", ctx)).toBe(3);
    expect(resolveProgressIndex("cursor", ctx)).toBe(4);
  });

  it("uses canonical verdict statuses for finale progress (ready_to_ship only)", () => {
    const { verdict: almostReady } = generateProductionVerdict({
      projectId: PROJECT,
      repositoryId: PROJECT,
      scanId: SCAN,
      commitSha: "abc",
      branch: "main",
      scanStatus: "completed",
      securityScore: 78,
      filesAnalyzed: 120,
      filesDiscovered: 150,
      findings: [
        {
          id: "f1",
          title: "Missing rate limit",
          severity: "medium",
          category: "security",
          rule_id: "rate-limit",
          file_path: "src/api.ts",
          recommendation: "Add limiter",
          confidence: "high",
        },
      ],
      previousScore: null,
      previousBlockersCount: 0,
    });
    expect(almostReady.status).toBe("almost_ready");
    expect(
      resolveProgressIndex("finale", baseContext({ githubConnected: true, latestVerdict: almostReady }))
    ).toBe(3);

    const { verdict: readyToShip } = generateProductionVerdict({
      projectId: PROJECT,
      repositoryId: PROJECT,
      scanId: SCAN,
      commitSha: "def",
      branch: "main",
      scanStatus: "completed",
      securityScore: 96,
      filesAnalyzed: 120,
      filesDiscovered: 150,
      findings: [],
      previousScore: null,
      previousBlockersCount: 0,
    });
    expect(readyToShip.status).toBe("ready_to_ship");
    expect(
      resolveProgressIndex("finale", baseContext({ githubConnected: true, latestVerdict: readyToShip }))
    ).toBe(4);
    const scanProject = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const newestProject = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(
      resolveOnboardingProjectId(
        baseContext({
          projects: [
            {
              id: newestProject,
              name: "new",
              githubRepo: null,
              defaultBranch: null,
              isPrivate: null,
              updatedAt: new Date().toISOString(),
            },
          ],
          activeScan: {
            id: SCAN,
            projectId: scanProject,
            status: "SCANNING",
            progress: 40,
            progressMessage: null,
          },
        })
      )
    ).toBe(scanProject);
  });

  it("mobile and desktop layouts expose four progress steps", () => {
    expect(PROGRESS_STEPS).toHaveLength(4);
    expect(PROGRESS_STEPS[0].labelKey).toBe("progress.github");
    expect(PROGRESS_STEPS[3].labelKey).toBe("progress.verdict");
  });
});
