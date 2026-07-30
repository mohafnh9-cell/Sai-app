import type { SecurityTestPhase, SecurityTestProgressStep } from "../types";

/** User-facing journey labels — never expose internal engine terms. */
export const PROGRESS_STEP_LABELS = {
  choose: "Review code",
  run: "Test application",
  fix: "Protect app",
  verify: "Verify protection",
} as const;

export const ESTIMATED_TEST_DURATION = "About 2 minutes";

export const SAFETY_NOTE =
  "Nothing in production will be modified. SequrAI only runs safe simulations.";

export function buildProgressStepsForPhase(phase: SecurityTestPhase): SecurityTestProgressStep[] {
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
    { id: "choose", label: PROGRESS_STEP_LABELS.choose, status: stepFor("choose") },
    { id: "run", label: PROGRESS_STEP_LABELS.run, status: stepFor("run") },
    { id: "fix", label: PROGRESS_STEP_LABELS.fix, status: stepFor("fix") },
    { id: "verify", label: PROGRESS_STEP_LABELS.verify, status: stepFor("verify") },
  ];
}

export type PhaseScreenCopy = {
  headline: string;
  description: string;
  primaryActionLabel: string;
  waitMessage: string | null;
  showEstimatedDuration: boolean;
  showSafetyNote: boolean;
};

export function copyForPhase(phase: SecurityTestPhase): PhaseScreenCopy {
  switch (phase) {
    case "needs_review":
      return {
        headline: "Let's review your code first",
        description:
          "SequrAI reads your latest version so it knows what to test safely afterward.",
        primaryActionLabel: "Review my code",
        waitMessage: null,
        showEstimatedDuration: true,
        showSafetyNote: true,
      };
    case "preparing":
      return {
        headline: "Preparing your test",
        description: "Please wait while SequrAI gets everything ready.",
        primaryActionLabel: "Please wait…",
        waitMessage: "Checking login, permissions, APIs, and AI features…",
        showEstimatedDuration: false,
        showSafetyNote: true,
      };
    case "ready":
      return {
        headline: "Your code review is complete",
        description:
          "Now let's safely test how your application behaves in real situations.",
        primaryActionLabel: "Test my application",
        waitMessage: null,
        showEstimatedDuration: true,
        showSafetyNote: true,
      };
    case "running":
      return {
        headline: "Testing your application",
        description: "SequrAI is running safe tests. This usually takes a couple of minutes.",
        primaryActionLabel: "View progress",
        waitMessage: "Please wait — your app is being tested now.",
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "issues_found":
      return {
        headline: "We found a problem",
        description:
          "A user could reach data or actions they should not have access to.",
        primaryActionLabel: "Protect my application",
        waitMessage: null,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "fix_ready":
      return {
        headline: "Protection is ready",
        description: "SequrAI prepared steps to close the gap we found.",
        primaryActionLabel: "Protect my application",
        waitMessage: null,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "protected":
      return {
        headline: "Protection verified",
        description: "We tried again and your application blocked the problem.",
        primaryActionLabel: "Deploy with confidence",
        waitMessage: null,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "completed_clean":
      return {
        headline: "Your application looks good",
        description: "None of the safe tests found a way through in this version.",
        primaryActionLabel: "Deploy with confidence",
        waitMessage: null,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
  }
}

export const EMPTY_STATE_COPY = {
  headline: "Your application hasn't been tested yet",
  description:
    "SequrAI will safely simulate the most important problems real attackers try.",
  primaryActionLabel: "Start security test",
} as const;
