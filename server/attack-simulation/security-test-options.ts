import "server-only";

import type { AttackHypothesis } from "./contracts/attack-hypothesis";
import {
  ATTACK_ADAPTER_CATALOG,
  resolveAdapterForHypothesis,
} from "./planner/adapter-catalog";
import { buildFallbackSecurityTestOptions, friendlyTestCopy } from "@/features/security-testing/user-test-catalog";
import type { SecurityTestOption } from "@/features/security-testing/types";
import type { Translator } from "@/lib/i18n/types";

function severityFromConfidence(confidence: number): SecurityTestOption["severity"] {
  if (confidence >= 0.85) return "critical";
  if (confidence >= 0.7) return "high";
  if (confidence >= 0.5) return "medium";
  return "low";
}

export function buildSecurityTestOptionsFromHypotheses(
  hypotheses: AttackHypothesis[],
  t: Translator
): SecurityTestOption[] {
  return hypotheses.map((hypothesis) => {
    const adapter = resolveAdapterForHypothesis({
      category: hypothesis.category,
      title: hypothesis.title,
      description: hypothesis.description,
      adapterHint: hypothesis.adapterHint,
    });
    const friendly = friendlyTestCopy(adapter.id, t);
    return {
      id: hypothesis.id,
      title: hypothesis.title,
      description: friendly.description || hypothesis.description,
      severity: severityFromConfidence(hypothesis.confidence),
      categoryLabel: friendly.categoryLabel || hypothesis.category,
      recommended: hypothesis.severity === "critical" || hypothesis.severity === "high",
    };
  });
}

export function buildDefaultSecurityTestOptions(t: Translator): SecurityTestOption[] {
  return buildFallbackSecurityTestOptions(t);
}

export function mapSelectedTestsToHypotheses(
  selectedTestIds: string[],
  hypotheses: AttackHypothesis[],
  t: Translator
): AttackHypothesis[] {
  if (hypotheses.length > 0) {
    const selected = hypotheses.filter((hypothesis) => selectedTestIds.includes(hypothesis.id));
    if (selected.length > 0) return selected;
  }

  return selectedTestIds
    .filter((id) => ATTACK_ADAPTER_CATALOG.some((adapter) => adapter.id === id))
    .map((adapterId) => {
      const adapter = ATTACK_ADAPTER_CATALOG.find((entry) => entry.id === adapterId)!;
      const friendly = friendlyTestCopy(adapterId, t);
      return {
        id: adapterId,
        title: friendly.title || adapter.title,
        description: friendly.description || adapter.description,
        category: adapter.category,
        severity: "medium" as const,
        confidence: 0.7,
        source: "security_test.catalog",
        adapterHint: adapterId,
        metadata: { adapterHint: adapterId },
      };
    });
}
