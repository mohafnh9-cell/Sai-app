import type { AttackCenterCampaignView } from "@/features/attack-simulation/types";
import type { AttackExecutionStatus } from "@/server/attack-simulation/contracts/enums";
import type { SecurityTestPhase, SecurityTestProgressStep } from "../types";
import { USER_FRIENDLY_TEST_COPY } from "../user-test-catalog";
import {
  buildProgressStepsForPhase,
  copyForPhase,
} from "./product-copy";

const TERMINAL_EXECUTION_STATUSES = new Set<AttackExecutionStatus>([
  "completed",
  "failed",
  "blocked",
  "cancelled",
  "not_exploitable",
  "protected",
  "still_vulnerable",
  "fix_ready",
  "confirmed",
]);

const TERMINAL_CAMPAIGN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function executionStatusLabel(status: AttackExecutionStatus): string {
  switch (status) {
    case "queued":
      return "Waiting";
    case "planned":
    case "preparing":
    case "validating_preconditions":
    case "creating_fixtures":
      return "Getting ready";
    case "executing":
    case "observing":
    case "collecting_evidence":
      return "Testing now";
    case "evaluating":
    case "generating_mitigation":
      return "Checking";
    case "confirmed":
      return "Problem found";
    case "fix_ready":
      return "Needs protection";
    case "blocked":
      return "Blocked";
    case "not_exploitable":
      return "Looks safe";
    case "protected":
      return "Protected";
    case "still_vulnerable":
      return "Still open";
    case "applying_fix":
    case "replaying":
    case "cleaning_up":
      return "Verifying";
    case "completed":
      return "Done";
    case "failed":
      return "Could not finish";
    case "cancelled":
      return "Stopped";
    default:
      return "Testing";
  }
}

export function friendlyScenarioTitle(adapterId: string, fallback: string): string {
  return USER_FRIENDLY_TEST_COPY[adapterId]?.title ?? fallback;
}

export function deriveLiveTestPhase(view: AttackCenterCampaignView): SecurityTestPhase {
  const { campaign, executions } = view;

  if (executions.some((execution) => execution.status === "protected")) {
    return "protected";
  }
  if (executions.some((execution) => execution.status === "fix_ready")) {
    return "fix_ready";
  }
  if (executions.some((execution) => execution.status === "confirmed")) {
    return "issues_found";
  }
  if (!TERMINAL_CAMPAIGN_STATUSES.has(campaign.status)) {
    return "running";
  }
  if (campaign.confirmedFindings > 0) {
    return "issues_found";
  }
  return "completed_clean";
}

export function buildLiveProgressSteps(phase: SecurityTestPhase): SecurityTestProgressStep[] {
  return buildProgressStepsForPhase(phase);
}

export type LiveTestDisplay = {
  phase: SecurityTestPhase;
  headline: string;
  description: string;
  statusLabel: string;
  progressPercent: number;
  testsDone: number;
  testsTotal: number;
  showSpinner: boolean;
  waitMessage: string | null;
  primaryAction: { label: string; findingId?: string; href?: string } | null;
};

export function deriveLiveTestDisplay(view: AttackCenterCampaignView): LiveTestDisplay {
  const { campaign, executions } = view;
  const testsTotal = Math.max(campaign.totalExecutions, executions.length, 1);
  const testsDone = executions.filter((execution) =>
    TERMINAL_EXECUTION_STATUSES.has(execution.status)
  ).length;
  const progressPercent = Math.min(100, Math.round((testsDone / testsTotal) * 100));
  const phase = deriveLiveTestPhase(view);
  const screenCopy = copyForPhase(phase);

  const problemExecution = executions.find(
    (execution) =>
      execution.status === "fix_ready" ||
      execution.status === "confirmed"
  );

  if (problemExecution?.findingId && (phase === "fix_ready" || phase === "issues_found")) {
    return {
      phase,
      headline: screenCopy.headline,
      description: screenCopy.description,
      statusLabel: "Problem found",
      progressPercent,
      testsDone,
      testsTotal,
      showSpinner: false,
      waitMessage: null,
      primaryAction: {
        label: screenCopy.primaryActionLabel,
        findingId: problemExecution.findingId,
      },
    };
  }

  if (phase === "running") {
    return {
      phase,
      headline: screenCopy.headline,
      description: screenCopy.description,
      statusLabel: "Testing",
      progressPercent,
      testsDone,
      testsTotal,
      showSpinner: true,
      waitMessage: screenCopy.waitMessage,
      primaryAction: null,
    };
  }

  if (phase === "protected" || phase === "completed_clean") {
    return {
      phase,
      headline: screenCopy.headline,
      description: screenCopy.description,
      statusLabel: phase === "protected" ? "Protected" : "All done",
      progressPercent: 100,
      testsDone,
      testsTotal,
      showSpinner: false,
      waitMessage: null,
      primaryAction: {
        label: screenCopy.primaryActionLabel,
        href: `/projects/${view.projectId}/mission-control`,
      },
    };
  }

  return {
    phase,
    headline: screenCopy.headline,
    description: screenCopy.description,
    statusLabel: "In progress",
    progressPercent,
    testsDone,
    testsTotal,
    showSpinner: false,
    waitMessage: null,
    primaryAction: null,
  };
}

export function humanFeedLabel(label: string): string {
  const map: Record<string, string> = {
    "Attack scenarios planned": "Tests selected",
    "Attack execution started": "A test started",
    "Evidence collected": "Proof saved",
    "Vulnerability confirmed": "Problem found",
    "Attack not exploitable": "This test passed",
    "Attack blocked by Safe Runtime": "Your app blocked it",
    "Safe Fix ready": "Protection ready",
    "Protection replay started": "Verifying protection",
    "Protection verified": "Protection verified",
    "Application still vulnerable": "Still needs a fix",
    "Attack failed": "Test could not finish",
    "Attack cancelled": "Test stopped",
  };
  if (map[label]) return map[label];
  if (label.startsWith("Step started:")) return `Now: ${label.replace("Step started: ", "")}`;
  if (label.startsWith("Step completed:")) return `Done: ${label.replace("Step completed: ", "")}`;
  return label;
}
