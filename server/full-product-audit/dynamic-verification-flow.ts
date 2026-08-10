import "server-only";

import type { McpTranslator } from "@/server/mcp/i18n";

export type DynamicVerificationDecision = "authorize" | "static_only";

export type DynamicVerificationState = {
  offered: boolean;
  decision: DynamicVerificationDecision | null;
  authorizedTarget: string | null;
  awaitingUrl: boolean;
  awaitingAuthorization: boolean;
  notSafelyTestableCount: number;
};

export function shouldOfferDynamicVerification(input: {
  staticFindingsCount: number;
  selectedAdapterCount: number;
  hasAuthorizedTarget: boolean;
}): boolean {
  return (
    input.staticFindingsCount > 0 &&
    input.selectedAdapterCount > 0 &&
    !input.hasAuthorizedTarget
  );
}

export function resolveDynamicVerificationExecution(input: {
  decision?: DynamicVerificationDecision;
  hasAuthorizedTarget: boolean;
  staticFindingsCount: number;
  selectedAdapterCount: number;
  authorizedTarget?: string | null;
}): {
  runDynamic: boolean;
  skippedReason: string | null;
  state: DynamicVerificationState;
} {
  const baseState: DynamicVerificationState = {
    offered: false,
    decision: input.decision ?? null,
    authorizedTarget: input.authorizedTarget ?? null,
    awaitingUrl: false,
    awaitingAuthorization: false,
    notSafelyTestableCount: 0,
  };

  if (input.decision === "static_only") {
    return {
      runDynamic: false,
      skippedReason: "user_declined_dynamic",
      state: { ...baseState, offered: false },
    };
  }

  if (input.hasAuthorizedTarget) {
    return {
      runDynamic: true,
      skippedReason: null,
      state: {
        ...baseState,
        authorizedTarget: input.authorizedTarget ?? baseState.authorizedTarget,
      },
    };
  }

  if (input.decision === "authorize") {
    return {
      runDynamic: false,
      skippedReason: "awaiting_authorization",
      state: { ...baseState, awaitingUrl: true, awaitingAuthorization: true },
    };
  }

  if (
    shouldOfferDynamicVerification({
      staticFindingsCount: input.staticFindingsCount,
      selectedAdapterCount: input.selectedAdapterCount,
      hasAuthorizedTarget: false,
    })
  ) {
    return {
      runDynamic: false,
      skippedReason: "dynamic_not_authorized",
      state: { ...baseState, offered: true },
    };
  }

  return {
    runDynamic: false,
    skippedReason:
      input.staticFindingsCount === 0 ? "no_findings" : "dynamic_not_authorized",
    state: baseState,
  };
}

export function buildDynamicVerificationOfferSummary(t: McpTranslator, findingsCount: number): string {
  return [
    t("fullProductAudit.dynamicVerificationOfferHeader"),
    "",
    t("fullProductAudit.dynamicVerificationOfferBody", { count: String(findingsCount) }),
    "",
    t("fullProductAudit.dynamicVerificationOfferActions"),
  ].join("\n");
}

export function buildStaticOnlySummary(t: McpTranslator): string {
  return [
    t("fullProductAudit.staticOnlyComplete"),
    "",
    t("fullProductAudit.dynamicTestingHeader"),
    t("fullProductAudit.dynamicTestingNotExecuted"),
    t("fullProductAudit.dynamicTestingStaticOnlyReason"),
  ].join("\n");
}

export function buildAwaitingUrlSummary(t: McpTranslator): string {
  return [
    t("fullProductAudit.dynamicVerificationUrlPrompt"),
    "",
    t("fullProductAudit.dynamicVerificationUrlExamples"),
  ].join("\n");
}

export function skippedReasonLabel(reason: string | null, t: McpTranslator): string {
  if (!reason) return "";
  const key = `fullProductAudit.skippedReasons.${reason}`;
  const translated = t(key);
  return translated === key ? reason : translated;
}
