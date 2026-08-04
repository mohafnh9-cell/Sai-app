import type { AttackCenterCampaignView } from "@/features/attack-simulation/types";
import type { AttackExecutionStatus } from "@/server/attack-simulation/contracts/enums";
import type { Translator } from "@/lib/i18n/types";
import type { SecurityTestPhase, SecurityTestProgressStep } from "../types";
import { buildProgressStepsForPhase, copyForPhase } from "./product-copy";
import { deriveSecurityTestPhase } from "./derive-phase";

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

export function executionStatusLabel(status: AttackExecutionStatus, t: Translator): string {
  const key = `executionStatus.${status}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return t("executionStatus.default");
}

export function friendlyScenarioTitle(adapterId: string, fallback: string, t: Translator): string {
  const key = `tests.${adapterId}.title`;
  const translated = t(key);
  return translated !== key ? translated : fallback;
}

export function deriveLiveTestPhase(view: AttackCenterCampaignView): SecurityTestPhase {
  return deriveSecurityTestPhase({
    reviewInProgress: false,
    hasLatestScan: true,
    campaignStatus: view.campaign.status,
    executionStatuses: view.executions.map((execution) => execution.status),
  });
}

export function buildLiveProgressSteps(
  phase: SecurityTestPhase,
  t: Translator
): SecurityTestProgressStep[] {
  return buildProgressStepsForPhase(phase, t);
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

export function deriveLiveTestDisplay(view: AttackCenterCampaignView, t: Translator): LiveTestDisplay {
  const { campaign, executions } = view;
  const testsTotal = Math.max(campaign.totalExecutions, executions.length, 1);
  const testsDone = executions.filter((execution) =>
    TERMINAL_EXECUTION_STATUSES.has(execution.status)
  ).length;
  const progressPercent = Math.min(100, Math.round((testsDone / testsTotal) * 100));
  const phase = deriveLiveTestPhase(view);
  const screenCopy = copyForPhase(phase, t);

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
      statusLabel: t("liveStatus.problemFound"),
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
      statusLabel: t("liveStatus.testing"),
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
      statusLabel:
        phase === "protected" ? t("liveStatus.protected") : t("liveStatus.allDone"),
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
    statusLabel: t("liveStatus.inProgress"),
    progressPercent,
    testsDone,
    testsTotal,
    showSpinner: false,
    waitMessage: null,
    primaryAction: null,
  };
}

const FEED_LABEL_KEYS: Record<string, string> = {
  "Attack scenarios planned": "feed.scenariosPlanned",
  "Attack execution started": "feed.executionStarted",
  "Evidence collected": "feed.evidenceCollected",
  "Vulnerability confirmed": "feed.vulnerabilityConfirmed",
  "Attack not exploitable": "feed.notExploitable",
  "Attack blocked by Safe Runtime": "feed.blockedByRuntime",
  "Safe Fix ready": "feed.safeFixReady",
  "Protection replay started": "feed.replayStarted",
  "Protection verified": "feed.protectionVerified",
  "Application still vulnerable": "feed.stillVulnerable",
  "Attack failed": "feed.attackFailed",
  "Attack cancelled": "feed.attackCancelled",
};

export function humanFeedLabel(label: string, t: Translator): string {
  if (FEED_LABEL_KEYS[label]) return t(FEED_LABEL_KEYS[label]);
  if (label.startsWith("Step started:")) {
    return t("feed.stepStarted", { step: label.replace("Step started: ", "") });
  }
  if (label.startsWith("Step completed:")) {
    return t("feed.stepCompleted", { step: label.replace("Step completed: ", "") });
  }
  return label;
}
