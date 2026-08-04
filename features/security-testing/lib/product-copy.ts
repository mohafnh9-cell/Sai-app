import type { Translator } from "@/lib/i18n/types";
import type { SecurityTestPhase, SecurityTestProgressStep } from "../types";

export function buildProgressStepsForPhase(
  phase: SecurityTestPhase,
  t: Translator
): SecurityTestProgressStep[] {
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
    const readyIdx = order.indexOf("ready");
    const validateDoneIdx = order.indexOf("protected");

    if (id === "choose") {
      return idx >= readyIdx ? "done" : "current";
    }
    if (id === "run") {
      return idx >= readyIdx ? "done" : "upcoming";
    }
    if (id === "fix") {
      if (idx >= validateDoneIdx || idx === order.indexOf("completed_clean")) return "done";
      if (idx >= readyIdx) return "current";
      return "upcoming";
    }
    if (idx === order.indexOf("protected") || idx === order.indexOf("completed_clean")) return "done";
    if (idx >= order.indexOf("fix_ready")) return "current";
    return "upcoming";
  };

  return [
    { id: "choose", label: t("progressSteps.choose"), status: stepFor("choose") },
    { id: "run", label: t("progressSteps.run"), status: stepFor("run") },
    { id: "fix", label: t("progressSteps.fix"), status: stepFor("fix") },
    { id: "verify", label: t("progressSteps.verify"), status: stepFor("verify") },
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

export function copyForPhase(phase: SecurityTestPhase, t: Translator): PhaseScreenCopy {
  const waitRaw = t(`phases.${phase}.waitMessage`);
  const waitMessage = waitRaw.trim().length > 0 ? waitRaw : null;

  switch (phase) {
    case "needs_review":
      return {
        headline: t("phases.needs_review.headline"),
        description: t("phases.needs_review.description"),
        primaryActionLabel: t("phases.needs_review.primaryAction"),
        waitMessage,
        showEstimatedDuration: true,
        showSafetyNote: true,
      };
    case "preparing":
      return {
        headline: t("phases.preparing.headline"),
        description: t("phases.preparing.description"),
        primaryActionLabel: t("phases.preparing.primaryAction"),
        waitMessage,
        showEstimatedDuration: false,
        showSafetyNote: true,
      };
    case "ready":
      return {
        headline: t("phases.ready.headline"),
        description: t("phases.ready.description"),
        primaryActionLabel: t("phases.ready.primaryAction"),
        waitMessage,
        showEstimatedDuration: true,
        showSafetyNote: true,
      };
    case "running":
      return {
        headline: t("phases.running.headline"),
        description: t("phases.running.description"),
        primaryActionLabel: t("phases.running.primaryAction"),
        waitMessage,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "issues_found":
      return {
        headline: t("phases.issues_found.headline"),
        description: t("phases.issues_found.description"),
        primaryActionLabel: t("phases.issues_found.primaryAction"),
        waitMessage,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "fix_ready":
      return {
        headline: t("phases.fix_ready.headline"),
        description: t("phases.fix_ready.description"),
        primaryActionLabel: t("phases.fix_ready.primaryAction"),
        waitMessage,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "protected":
      return {
        headline: t("phases.protected.headline"),
        description: t("phases.protected.description"),
        primaryActionLabel: t("phases.protected.primaryAction"),
        waitMessage,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
    case "completed_clean":
      return {
        headline: t("phases.completed_clean.headline"),
        description: t("phases.completed_clean.description"),
        primaryActionLabel: t("phases.completed_clean.primaryAction"),
        waitMessage,
        showEstimatedDuration: false,
        showSafetyNote: false,
      };
  }
}

export function emptyStateCopy(t: Translator) {
  return {
    headline: t("emptyState.headline"),
    description: t("emptyState.description"),
    primaryActionLabel: t("emptyState.primaryAction"),
  };
}

export function estimatedTestDuration(t: Translator): string {
  return t("estimatedDuration");
}

export function safetyNote(t: Translator): string {
  return t("safetyNote");
}
