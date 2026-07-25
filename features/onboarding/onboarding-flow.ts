import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";

export const WIZARD_STEPS = [
  "welcome",
  "github",
  "repository",
  "review",
  "finale",
  "cursor",
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

/** Legacy step ids kept for deep links and bookmarks. */
const LEGACY_STEP_ALIASES: Record<string, WizardStep> = {
  engineer: "finale",
  roadmap: "finale",
  safefix: "finale",
  verdict: "finale",
  mcp: "cursor",
  dashboard: "cursor",
};

export const PROGRESS_STEPS = [
  { id: "github", labelKey: "progress.github" },
  { id: "repository", labelKey: "progress.repository" },
  { id: "review", labelKey: "progress.review" },
  { id: "verdict", labelKey: "progress.verdict" },
  { id: "ready", labelKey: "progress.ready" },
] as const;

export type ProgressStepId = (typeof PROGRESS_STEPS)[number]["id"];

export type OnboardingProject = {
  id: string;
  name: string;
  githubRepo: string | null;
  defaultBranch: string | null;
  isPrivate: boolean | null;
  updatedAt: string | null;
};

export type OnboardingScan = {
  id: string;
  projectId: string;
  status: string;
  progress: number | null;
  progressMessage: string | null;
};

export type OnboardingContext = {
  hasOrg: boolean;
  orgId: string | null;
  githubConnected: boolean;
  projects: OnboardingProject[];
  activeScan: OnboardingScan | null;
  latestCompletedScan: OnboardingScan | null;
  latestVerdict: ProductionVerdictV1 | null;
  isComplete: boolean;
};

const ACTIVE_SCAN_STATUSES = new Set([
  "QUEUED",
  "FETCHING_REPOSITORY",
  "INDEXING",
  "SCANNING",
  "CALCULATING_SCORE",
]);

export function scanIsActive(status?: string | null): boolean {
  return ACTIVE_SCAN_STATUSES.has(status?.toUpperCase() ?? "");
}

export function scanIsCompleted(status?: string | null): boolean {
  return status?.toLowerCase() === "completed";
}

export function resolveProgressIndex(
  wizardStep: WizardStep,
  ctx: Pick<
    OnboardingContext,
    "githubConnected" | "projects" | "activeScan" | "latestCompletedScan" | "latestVerdict"
  >
): number {
  if (wizardStep === "cursor") return PROGRESS_STEPS.length;
  if (wizardStep === "finale") {
    const ready =
      ctx.latestVerdict?.status === "ready_to_ship" ||
      ctx.latestVerdict?.status === "ready_with_caution";
    return ready ? 4 : 3;
  }
  if (wizardStep === "review") {
    if (ctx.latestVerdict) return 3;
    return 2;
  }
  if (wizardStep === "repository") return ctx.projects.length > 0 ? 2 : 1;
  if (wizardStep === "github") return ctx.githubConnected ? 1 : 0;
  if (wizardStep === "welcome") return 0;
  return 0;
}

export function resolveInitialWizardStep(
  ctx: OnboardingContext,
  forcedStep?: WizardStep | null
): WizardStep {
  if (forcedStep && WIZARD_STEPS.includes(forcedStep)) {
    return forcedStep;
  }
  if (ctx.isComplete) return "cursor";
  if (!ctx.hasOrg) return "welcome";
  if (!ctx.githubConnected) return "github";
  if (ctx.projects.length === 0) return "repository";
  if (ctx.activeScan || !ctx.latestCompletedScan || !ctx.latestVerdict) return "review";
  return "finale";
}

export function parseWizardStep(value: string | null | undefined): WizardStep | null {
  if (!value) return null;
  const aliased = LEGACY_STEP_ALIASES[value];
  if (aliased) return aliased;
  return WIZARD_STEPS.includes(value as WizardStep) ? (value as WizardStep) : null;
}

export function parseLegacyStepParam(value: string | null | undefined): WizardStep | null {
  if (value == null) return null;
  const index = Number(value);
  if (!Number.isFinite(index)) return null;
  const legacy: WizardStep[] = [
    "welcome",
    "github",
    "repository",
    "review",
    "finale",
    "cursor",
  ];
  return legacy[Math.min(Math.max(index, 0), legacy.length - 1)] ?? null;
}

export function shouldSkipGitHubStep(ctx: Pick<OnboardingContext, "githubConnected">): boolean {
  return ctx.githubConnected;
}

export function onboardingRedirectPath(ctx: Pick<OnboardingContext, "isComplete">): string {
  return ctx.isComplete ? "/dashboard" : "/onboarding";
}
