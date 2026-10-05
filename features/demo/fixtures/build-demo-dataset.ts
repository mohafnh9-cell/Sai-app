import { verdictAffirmsDeploy } from "@/brain/production-verdict/deployment-posture";
import "server-only";

import {
  BRAIN_VERSION,
  type OrgBrainSnapshot,
  type ProjectBrainSnapshot,
  type ProjectBrainSummary,
} from "@/brain";
import { buildProductionRoadmap } from "@/brain/production-experience/roadmap";
import type { AutopilotDashboardView, AutopilotProjectView } from "@/brain/autopilot-experience";
import { buildProductionIntelligence } from "@/brain/production-intelligence";
import type {
  ProductionIntelligence,
  ProductionIntelligencePreview,
} from "@/brain/production-intelligence/schema";
import { buildProductionJourney, type VerdictJourneyRecord } from "@/brain/production-journey";
import type { ProductionJourney } from "@/brain/production-journey/schema";
import { generateProductionVerdict } from "@/brain/production-verdict/engine";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import {
  EMPTY_PRODUCTION_READY,
  prioritiesFromVerdict,
  productionReadyFromVerdict,
} from "@/server/brain/verdict-view-model";
import type { ProjectRow } from "@/types/database";
import {
  DEMO_GITHUB_REPO,
  DEMO_ORG_ID,
  DEMO_ORG_NAME,
  DEMO_PROJECT_ACME,
  DEMO_PROJECT_NORTHWIND,
  DEMO_SCAN_ACME,
  DEMO_SCAN_NORTHWIND,
} from "../constants";
import type { DemoScenarioId } from "../scenarios";

const NOW = "2026-07-18T10:00:00.000Z";
const DAY = (offset: number) =>
  new Date(Date.UTC(2026, 6, 10 + offset, 12, 0, 0)).toISOString();

const BLOCKER_FINDINGS = [
  {
    id: "demo-f1",
    title: "Permissive RLS policy on user profiles",
    severity: "critical",
    category: "authorization",
    rule_id: "rls-permissive",
    file_path: "supabase/schema.sql",
    recommendation: "Restrict the policy with authenticated user predicates.",
    confidence: "high",
  },
  {
    id: "demo-f2",
    title: "Missing rate limiting on auth endpoints",
    severity: "high",
    category: "security",
    rule_id: "rate-limit",
    file_path: "src/app/api/auth/route.ts",
    recommendation: "Add rate limiting middleware.",
    confidence: "high",
  },
  {
    id: "demo-f3",
    title: "Service role referenced in client bundle",
    severity: "critical",
    category: "secrets",
    rule_id: "service-role-client",
    file_path: "src/lib/supabase/admin-client.ts",
    recommendation: "Move service role usage to server-only code.",
    confidence: "high",
  },
];

function verdictInput(
  projectId: string,
  scanId: string,
  overrides: Partial<Parameters<typeof generateProductionVerdict>[0]> = {}
) {
  return {
    projectId,
    repositoryId: projectId,
    scanId,
    commitSha: "demo7a1b2c3d4e5f6789012345678901234567890ab",
    branch: "main",
    scanStatus: "completed" as const,
    securityScore: 72,
    filesAnalyzed: 120,
    filesDiscovered: 150,
    findings: [],
    previousScore: 68,
    previousBlockersCount: 2,
    ...overrides,
  };
}

function demoUuid(sequence: number): string {
  return `a0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function journeyRecord(
  projectId: string,
  index: number,
  verdict: ProductionVerdictV1
): VerdictJourneyRecord {
  return {
    id: demoUuid(10_000 + index),
    scanId: verdict.scanId,
    projectId,
    repositoryId: projectId,
    generatedAt: verdict.generatedAt,
    commitSha: verdict.commitSha,
    branch: verdict.branch,
    status: verdict.status,
    score: verdict.score,
    previousScore: verdict.previousScore,
    scoreDelta: verdict.scoreDelta,
    blockersCount: verdict.blockersCount,
    introducedBlockers: verdict.introducedBlockers,
    resolvedBlockers: verdict.resolvedBlockers,
    verdict,
  };
}

function projectRow(
  id: string,
  name: string,
  overrides: Partial<ProjectRow> = {}
): ProjectRow {
  return {
    id,
    organization_id: DEMO_ORG_ID,
    name,
    description: "Fictional demo repository for product review.",
    github_repo: DEMO_GITHUB_REPO,
    production_url: null,
    framework: "NEXTJS",
    security_score: 72,
    last_scan_at: NOW,
    github_repository_id: 900001,
    github_is_private: true,
    github_default_branch: "main",
    github_connected_at: DAY(0),
    webhook_enabled: true,
    repository_health: "healthy",
    created_at: DAY(-14),
    updated_at: NOW,
    ...overrides,
  } as ProjectRow;
}

function summaryFromVerdict(
  project: Pick<ProjectRow, "id" | "name" | "repository_health">,
  verdict: ProductionVerdictV1 | null
): ProjectBrainSummary {
  if (!verdict) {
    return {
      projectId: project.id,
      projectName: project.name,
      productionReady: null,
      scoreDelta: null,
      projectedScore: null,
      blockersCount: 0,
      healthStatus: project.repository_health ?? null,
      status: "insufficient_data",
      lastReviewedCommit: null,
      generatedAt: null,
      affirmsDeploy: false,
    };
  }

  return {
    projectId: project.id,
    projectName: project.name,
    productionReady: verdict.score,
    scoreDelta: verdict.scoreDelta,
    projectedScore: verdict.projectedScore,
    blockersCount: verdict.blockersCount,
    healthStatus: project.repository_health ?? null,
    status: verdict.status,
    lastReviewedCommit: verdict.commitSha,
    generatedAt: verdict.generatedAt,
    affirmsDeploy: verdictAffirmsDeploy(verdict),
  };
}

function buildProjectBrainSnapshot(
  project: ProjectRow,
  verdict: ProductionVerdictV1 | null,
  webhookEnabled: boolean
): ProjectBrainSnapshot {
  return {
    projectId: project.id,
    organizationId: DEMO_ORG_ID,
    projectName: project.name,
    githubRepo: project.github_repo,
    currentVerdict: verdict,
    productionReady: verdict ? productionReadyFromVerdict(verdict) : EMPTY_PRODUCTION_READY,
    securityScore: verdict?.score ?? null,
    riskScore: verdict?.score != null ? Math.max(0, 100 - (verdict.score ?? 0)) : null,
    healthStatus: project.repository_health ?? null,
    lastScanAt: project.last_scan_at,
    lastCommitSha: verdict?.commitSha ?? null,
    webhookEnabled,
    todayPriorities: verdict ? prioritiesFromVerdict(verdict) : [],
    coachTip: null,
    executiveSummary: verdict?.executiveSummary ?? null,
    recentActivity: [
      {
        id: "demo-activity-1",
        eventType: "push_received",
        title: "Push received on main",
        description: "Continuous Reviews queued a Production Review.",
        occurredAt: DAY(0),
        source: "repository_activity",
      },
    ],
    snapshotAt: NOW,
    brainVersion: BRAIN_VERSION,
  };
}

function buildOrgBrain(projects: ProjectRow[], verdicts: Map<string, ProductionVerdictV1 | null>): OrgBrainSnapshot {
  const summaries = projects.map((project) =>
    summaryFromVerdict(project, verdicts.get(project.id) ?? null)
  );
  const dimensionSets = summaries
    .map((summary) => {
      const verdict = verdicts.get(summary.projectId);
      return verdict && verdict.score !== null ? productionReadyFromVerdict(verdict).dimensions : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const averageDimensions = {
    security: average(dimensionSets.map((d) => d.security)),
    authentication: average(dimensionSets.map((d) => d.authentication)),
    databaseDesign: average(dimensionSets.map((d) => d.databaseDesign)),
    bestPractices: average(dimensionSets.map((d) => d.bestPractices)),
    architecture: average(dimensionSets.map((d) => d.architecture)),
    performance: average(dimensionSets.map((d) => d.performance)),
    deploymentReadiness: average(dimensionSets.map((d) => d.deploymentReadiness)),
  };

  const scored = summaries.filter((item) => item.productionReady !== null);
  const averageProductionReady =
    scored.length > 0
      ? Math.round(scored.reduce((sum, item) => sum + (item.productionReady ?? 0), 0) / scored.length)
      : null;

  const todayPriorities =
    summaries[0] && verdicts.get(summaries[0].projectId)
      ? prioritiesFromVerdict(verdicts.get(summaries[0].projectId)!)
      : [];

  return {
    organizationId: DEMO_ORG_ID,
    averageProductionReady,
    averageDimensions,
    totalBlockers: summaries.reduce((sum, item) => sum + item.blockersCount, 0),
    totalEstimatedMinutes: Array.from(verdicts.values()).reduce(
      (sum, verdict) => sum + (verdict?.estimatedFixMinutes ?? 0),
      0
    ),
    productionRoadmap: buildProductionRoadmap({
      currentScore: averageProductionReady,
      priorities: todayPriorities,
    }),
    projects: summaries,
    todayPriorities,
    recentActivity: [
      {
        id: "demo-org-activity",
        eventType: "automatic_review_completed",
        title: "Production Review completed",
        description: "Continuous Reviews updated the Production Verdict.",
        occurredAt: DAY(0),
        source: "repository_activity",
      },
    ],
    snapshotAt: NOW,
    brainVersion: BRAIN_VERSION,
  };
}

function average(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value !== null);
  if (!filtered.length) return null;
  return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length);
}

function intelligenceFromJourney(
  journey: ProductionJourney,
  verdict: ProductionVerdictV1 | null
): ProductionIntelligence {
  return buildProductionIntelligence({
    journey,
    verdict,
  });
}

function previewFromIntelligence(intelligence: ProductionIntelligence): ProductionIntelligencePreview {
  return {
    projectId: intelligence.projectId,
    currentStatus: intelligence.currentStatus,
    currentScore: intelligence.currentScore,
    scoreDelta: intelligence.scoreDelta,
    momentum: intelligence.momentum,
    recommendedAction: intelligence.recommendedAction,
    currentFocusKey: intelligence.currentFocusKey,
    emptyState: intelligence.emptyState,
  };
}

export type DemoDataset = {
  scenarioId: DemoScenarioId;
  orgName: string;
  projects: ProjectRow[];
  orgBrain: OrgBrainSnapshot;
  projectBrains: Record<string, ProjectBrainSnapshot>;
  intelligenceByProject: Record<string, ProductionIntelligence>;
  intelligencePreviews: Record<string, ProductionIntelligencePreview>;
  journeys: Record<string, ProductionJourney>;
  autopilotDashboard: AutopilotDashboardView;
  autopilotByProject: Record<string, AutopilotProjectView>;
  primaryProjectId: string | null;
  primaryScanId: string | null;
  showFirstVerdictModal: boolean;
  githubConnected: boolean;
};

function autopilotProjectView(
  state: AutopilotProjectView["state"],
  verdict: ProductionVerdictV1 | null
): AutopilotProjectView {
  return {
    state,
    autopilotEnabled: state !== "disabled" && state !== "repository_disconnected",
    lastAutomaticReviewAt: state === "reviewing_changes" ? null : DAY(0),
    scoreDelta: verdict?.scoreDelta ?? null,
    currentStatus: verdict?.status ?? null,
    recommendedActionTitle: verdict?.topPriorities[0]?.title ?? null,
    latestImprovementKey: null,
    latestImprovementParams: null,
    closerToProduction: verdict?.status === "ready_to_ship" || verdict?.status === "almost_ready",
  };
}

export function buildDemoDataset(scenarioId: DemoScenarioId): DemoDataset {
  switch (scenarioId) {
    case "ready-to-ship":
      return buildReadyToShip();
    case "not-ready":
      return buildNotReady();
    case "more-analysis-required":
      return buildMoreAnalysisRequired();
    case "analysis-failed":
      return buildAnalysisFailed();
    case "review-in-progress":
      return buildReviewInProgress();
    case "github-disconnected":
      return buildGithubDisconnected();
    case "no-projects":
      return buildNoProjects();
    case "first-verdict":
      return buildFirstVerdict();
    default:
      return buildReadyToShip();
  }
}

function buildReadyToShip(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS");
  const northwind = projectRow(DEMO_PROJECT_NORTHWIND, "Northwind API", {
    github_repo: "https://github.com/demo-org/northwind-api",
  });

  const acmeVerdict = {
    ...generateProductionVerdict(
      verdictInput(DEMO_PROJECT_ACME, DEMO_SCAN_ACME, {
        securityScore: 88,
        findings: [],
        previousScore: 82,
      })
    ).verdict,
    generatedAt: DAY(0),
  };
  acmeVerdict.status = "ready_to_ship";
  acmeVerdict.score = 88;
  acmeVerdict.blockersCount = 0;
  acmeVerdict.criticalBlockersCount = 0;
  acmeVerdict.highBlockersCount = 0;
  // The demo's "ready" project is a fully evaluated, high-confidence example.
  acmeVerdict.confidence = "high";
  acmeVerdict.unevaluatedAreas = [];
  acmeVerdict.partiallyEvaluatedAreas = [];

  const northwindVerdict = {
    ...generateProductionVerdict(
      verdictInput(DEMO_PROJECT_NORTHWIND, DEMO_SCAN_NORTHWIND, {
        securityScore: 74,
        findings: [BLOCKER_FINDINGS[1]],
        previousScore: 70,
      })
    ).verdict,
    generatedAt: DAY(-1),
  };
  northwindVerdict.status = "almost_ready";
  northwindVerdict.score = 74;

  return assembleDataset("ready-to-ship", [acme, northwind], new Map([
    [acme.id, acmeVerdict],
    [northwind.id, northwindVerdict],
  ]), {
    autopilotStates: { [acme.id]: "up_to_date", [northwind.id]: "waiting_for_changes" },
    githubConnected: true,
  });
}

function buildNotReady(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS");
  const verdict = {
    ...generateProductionVerdict(
      verdictInput(DEMO_PROJECT_ACME, DEMO_SCAN_ACME, {
        securityScore: 35,
        findings: BLOCKER_FINDINGS,
        previousScore: 42,
      })
    ).verdict,
    generatedAt: DAY(0),
  };
  verdict.status = "not_ready";
  verdict.score = 35;

  return assembleDataset("not-ready", [acme], new Map([[acme.id, verdict]]), {
    autopilotStates: { [acme.id]: "enabled" },
    githubConnected: true,
  });
}

function buildMoreAnalysisRequired(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS");
  const verdict = generateProductionVerdict(
    verdictInput(DEMO_PROJECT_ACME, DEMO_SCAN_ACME, {
      filesAnalyzed: 0,
      filesDiscovered: 200,
      findings: [],
    })
  ).verdict;

  return assembleDataset("more-analysis-required", [acme], new Map([[acme.id, verdict]]), {
    autopilotStates: { [acme.id]: "waiting_for_changes" },
    githubConnected: true,
  });
}

function buildAnalysisFailed(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS");
  const verdict = generateProductionVerdict(
    verdictInput(DEMO_PROJECT_ACME, DEMO_SCAN_ACME, {
      scanStatus: "failed",
      partialScanFailure: true,
      findings: BLOCKER_FINDINGS.slice(0, 1),
    })
  ).verdict;

  return assembleDataset("analysis-failed", [acme], new Map([[acme.id, verdict]]), {
    autopilotStates: { [acme.id]: "review_failed" },
    githubConnected: true,
  });
}

function buildReviewInProgress(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS");
  const verdict = {
    ...generateProductionVerdict(
      verdictInput(DEMO_PROJECT_ACME, DEMO_SCAN_ACME, {
        securityScore: 62,
        findings: [BLOCKER_FINDINGS[1]],
      })
    ).verdict,
    generatedAt: DAY(-1),
  };
  verdict.status = "needs_improvement";
  verdict.score = 62;

  return assembleDataset("review-in-progress", [acme], new Map([[acme.id, verdict]]), {
    autopilotStates: { [acme.id]: "reviewing_changes" },
    githubConnected: true,
  });
}

function buildGithubDisconnected(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS", {
    github_repo: null,
    github_connected_at: null,
    webhook_enabled: false,
    repository_health: "disconnected",
  });

  return assembleDataset("github-disconnected", [acme], new Map([[acme.id, null]]), {
    autopilotStates: { [acme.id]: "repository_disconnected" },
    githubConnected: false,
  });
}

function buildNoProjects(): DemoDataset {
  return assembleDataset("no-projects", [], new Map(), {
    autopilotStates: {},
    githubConnected: false,
    autopilotEnabled: false,
  });
}

function buildFirstVerdict(): DemoDataset {
  const acme = projectRow(DEMO_PROJECT_ACME, "Acme SaaS");
  const verdict = {
    ...generateProductionVerdict(
      verdictInput(DEMO_PROJECT_ACME, DEMO_SCAN_ACME, {
        securityScore: 58,
        findings: [BLOCKER_FINDINGS[1]],
        previousScore: null,
        previousBlockersCount: 0,
      })
    ).verdict,
    generatedAt: DAY(0),
  };
  verdict.status = "needs_improvement";
  verdict.score = 58;
  verdict.scoreDelta = null;

  return assembleDataset("first-verdict", [acme], new Map([[acme.id, verdict]]), {
    autopilotStates: { [acme.id]: "enabled" },
    githubConnected: true,
    showFirstVerdictModal: true,
    journeyRecords: (projectId, verdict) => [journeyRecord(projectId, 0, verdict)],
  });
}

function assembleDataset(
  scenarioId: DemoScenarioId,
  projects: ProjectRow[],
  verdicts: Map<string, ProductionVerdictV1 | null>,
  options: {
    autopilotStates: Record<string, AutopilotProjectView["state"]>;
    githubConnected: boolean;
    autopilotEnabled?: boolean;
    showFirstVerdictModal?: boolean;
    journeyRecords?: (projectId: string, verdict: ProductionVerdictV1) => VerdictJourneyRecord[];
  }
): DemoDataset {
  const projectBrains: Record<string, ProjectBrainSnapshot> = {};
  const intelligenceByProject: Record<string, ProductionIntelligence> = {};
  const intelligencePreviews: Record<string, ProductionIntelligencePreview> = {};
  const journeys: Record<string, ProductionJourney> = {};
  const autopilotByProject: Record<string, AutopilotProjectView> = {};

  for (const project of projects) {
    const verdict = verdicts.get(project.id) ?? null;
    projectBrains[project.id] = buildProjectBrainSnapshot(
      project,
      verdict,
      project.webhook_enabled !== false
    );

    if (verdict) {
      const records =
        options.journeyRecords?.(project.id, verdict) ??
        [
          journeyRecord(project.id, 0, { ...verdict, score: (verdict.previousScore ?? 40) as number, generatedAt: DAY(-7) }),
          journeyRecord(project.id, 1, verdict),
        ];
      const journey = buildProductionJourney(records);
      journeys[project.id] = journey;
      const intelligence = intelligenceFromJourney(journey, verdict);
      intelligenceByProject[project.id] = intelligence;
      intelligencePreviews[project.id] = previewFromIntelligence(intelligence);
    }

    autopilotByProject[project.id] = autopilotProjectView(
      options.autopilotStates[project.id] ?? "enabled",
      verdict
    );
  }

  const autopilotEnabled = options.autopilotEnabled ?? projects.length > 0;
  const autopilotDashboard: AutopilotDashboardView = {
    autopilotEnabled,
    monitoredCount: projects.filter((project) => project.github_repo).length,
    waitingCount: projects.filter((project) => !project.last_scan_at).length,
    approachingProductionCount: Array.from(verdicts.values()).filter(
      (verdict) => verdict?.status === "almost_ready" || verdict?.status === "ready_to_ship"
    ).length,
    latestAutomaticReviewAt: projects.length ? DAY(0) : null,
    latestAutomaticReviewProjectName: projects[0]?.name ?? null,
    projects: projects.map((project) => ({
      projectId: project.id,
      projectName: project.name,
      state: options.autopilotStates[project.id] ?? "enabled",
      lastAutomaticReviewAt: DAY(0),
      currentStatus: verdicts.get(project.id)?.status ?? null,
      scoreDelta: verdicts.get(project.id)?.scoreDelta ?? null,
    })),
  };

  const primaryProjectId = projects[0]?.id ?? null;
  const primaryScanId = primaryProjectId ? DEMO_SCAN_ACME : null;

  return {
    scenarioId,
    orgName: DEMO_ORG_NAME,
    projects,
    orgBrain: buildOrgBrain(projects, verdicts),
    projectBrains,
    intelligenceByProject,
    intelligencePreviews,
    journeys,
    autopilotDashboard,
    autopilotByProject,
    primaryProjectId,
    primaryScanId,
    showFirstVerdictModal: options.showFirstVerdictModal ?? false,
    githubConnected: options.githubConnected,
  };
}

export function getDemoProject(
  dataset: DemoDataset,
  projectId: string
): ProjectRow | undefined {
  return dataset.projects.find((project) => project.id === projectId);
}
