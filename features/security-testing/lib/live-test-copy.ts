import type { AttackCenterCampaignView } from "@/features/attack-simulation/types";
import type { AttackExecutionStatus } from "@/server/attack-simulation/contracts/enums";
import type { SecurityTestPhase, SecurityTestProgressStep } from "../types";
import { USER_FRIENDLY_TEST_COPY } from "../user-test-catalog";

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
      return "Waiting to start";
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
      return "Checking result";
    case "confirmed":
      return "Problem found";
    case "fix_ready":
      return "Tap to fix";
    case "blocked":
      return "Your app blocked it";
    case "not_exploitable":
      return "Looks safe";
    case "protected":
      return "Fixed and verified";
    case "still_vulnerable":
      return "Still needs a fix";
    case "applying_fix":
    case "replaying":
    case "cleaning_up":
      return "Checking your fix";
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
  const stepFor = (id: SecurityTestProgressStep["id"]): SecurityTestProgressStep["status"] => {
    const order: SecurityTestPhase[] = [
      "needs_review",
      "preparing",
      "ready",
      "running",
      "issues_found",
      "fix_ready",
      "protected",
      "completed_clean",
    ];
    const idx = order.indexOf(phase);
    const chooseIdx = order.indexOf("ready");
    const runIdx = order.indexOf("running");
    const fixIdx = order.indexOf("issues_found");
    const verifyIdx = order.indexOf("protected");

    if (id === "choose") {
      if (idx >= runIdx) return "done";
      if (idx >= chooseIdx) return "current";
      return "upcoming";
    }
    if (id === "run") {
      if (idx >= fixIdx || idx === order.indexOf("completed_clean")) return "done";
      if (idx >= runIdx) return "current";
      return "upcoming";
    }
    if (id === "fix") {
      if (idx >= verifyIdx || idx === order.indexOf("completed_clean")) return "done";
      if (idx >= fixIdx) return "current";
      return "upcoming";
    }
    if (idx === order.indexOf("protected") || idx === order.indexOf("completed_clean")) return "done";
    if (idx >= fixIdx) return "current";
    return "upcoming";
  };

  return [
    { id: "choose", label: "Choose tests", status: stepFor("choose") },
    { id: "run", label: "Run safe attacks", status: stepFor("run") },
    { id: "fix", label: "Fix problems", status: stepFor("fix") },
    { id: "verify", label: "Verify protection", status: stepFor("verify") },
  ];
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
  primaryAction: { label: string; findingId: string } | null;
};

export function deriveLiveTestDisplay(view: AttackCenterCampaignView): LiveTestDisplay {
  const { campaign, executions } = view;
  const testsTotal = Math.max(campaign.totalExecutions, executions.length, 1);
  const testsDone = executions.filter((execution) =>
    TERMINAL_EXECUTION_STATUSES.has(execution.status)
  ).length;
  const progressPercent = Math.min(100, Math.round((testsDone / testsTotal) * 100));
  const phase = deriveLiveTestPhase(view);
  const fixReadyExecution = executions.find((execution) => execution.status === "fix_ready");

  if (fixReadyExecution) {
    return {
      phase,
      headline: "We found a problem",
      description:
        "One of our safe attacks got through. Tap the big button to see how to protect your app.",
      statusLabel: "Ready to fix",
      progressPercent,
      testsDone,
      testsTotal,
      showSpinner: false,
      primaryAction: fixReadyExecution.findingId
        ? { label: "Show me how to fix it", findingId: fixReadyExecution.findingId }
        : null,
    };
  }

  if (phase === "running") {
    const activeCount = executions.filter(
      (execution) => !TERMINAL_EXECUTION_STATUSES.has(execution.status)
    ).length;
    return {
      phase,
      headline: activeCount > 0 ? "Testing your app now" : "Finishing up",
      description: "Sit tight — we are running safe attacks to see if anything breaks.",
      statusLabel: "Running",
      progressPercent,
      testsDone,
      testsTotal,
      showSpinner: true,
      primaryAction: null,
    };
  }

  if (phase === "issues_found") {
    const confirmed = executions.find((execution) => execution.status === "confirmed");
    return {
      phase,
      headline: "We found something to fix",
      description: "Tap a test below to see what happened and how to protect your app.",
      statusLabel: "Needs protection",
      progressPercent,
      testsDone,
      testsTotal,
      showSpinner: false,
      primaryAction: confirmed?.findingId
        ? { label: "Protect my application", findingId: confirmed.findingId }
        : null,
    };
  }

  if (phase === "protected") {
    return {
      phase,
      headline: "Your fix worked",
      description: "We tried the attack again and your app blocked it.",
      statusLabel: "Protected",
      progressPercent: 100,
      testsDone,
      testsTotal,
      showSpinner: false,
      primaryAction: null,
    };
  }

  return {
    phase,
    headline: "All tests finished",
    description: "No successful attacks in this run. Your app handled the safe tests well.",
    statusLabel: "All done",
    progressPercent: 100,
    testsDone,
    testsTotal,
    showSpinner: false,
    primaryAction: null,
  };
}
