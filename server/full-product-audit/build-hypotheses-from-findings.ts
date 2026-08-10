import "server-only";

import type { AttackHypothesis } from "@/server/attack-simulation/contracts/attack-hypothesis";
import { ATTACK_SEVERITIES } from "@/server/attack-simulation/contracts/enums";
import type { Translator } from "@/lib/i18n/types";
import { friendlyTestCopy } from "@/features/security-testing/user-test-catalog";
import { ATTACK_ADAPTER_CATALOG } from "@/server/attack-simulation/planner/adapter-catalog";
import type { StaticFindingInput } from "./correlate-findings";
import { adaptersForFinding, mapFindingToDynamicFixtures } from "./infer-route-from-finding";
import { selectAttacksFromFindings } from "./select-attacks-from-findings";

function normalizeSeverity(value: string | null | undefined): AttackHypothesis["severity"] {
  const raw = (value ?? "medium").toLowerCase();
  return ATTACK_SEVERITIES.includes(raw as AttackHypothesis["severity"])
    ? (raw as AttackHypothesis["severity"])
    : "medium";
}

export type BuiltHypothesesResult = {
  hypotheses: AttackHypothesis[];
  notSafelyTestableCount: number;
};

export function buildHypothesesFromStaticFindings(input: {
  staticFindings: StaticFindingInput[];
  selectedAdapterIds?: string[];
  requireMappedRoutes?: boolean;
  t: Translator;
}): BuiltHypothesesResult {
  const selected = new Set(
    input.selectedAdapterIds ??
      selectAttacksFromFindings({ staticFindings: input.staticFindings })
  );

  const hypotheses: AttackHypothesis[] = [];
  let notSafelyTestableCount = 0;
  const seen = new Set<string>();

  for (const finding of input.staticFindings) {
    const findingAdapters = adaptersForFinding(finding).filter((adapterId) => selected.has(adapterId));

    for (const adapterId of findingAdapters) {
      const dedupeKey = `${finding.id}:${adapterId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const mapping = mapFindingToDynamicFixtures({ finding, adapterId });
      if (input.requireMappedRoutes && !mapping.testable) {
        notSafelyTestableCount += 1;
        continue;
      }

      const adapter = ATTACK_ADAPTER_CATALOG.find((entry) => entry.id === adapterId);
      const friendly = friendlyTestCopy(adapterId, input.t);

      hypotheses.push({
        id: dedupeKey,
        title: finding.title || friendly.title || adapter?.title || adapterId,
        description: finding.description || friendly.description || adapter?.description || "",
        category: (finding.category ?? adapter?.category ?? "general").toLowerCase(),
        severity: normalizeSeverity(finding.severity),
        confidence: 0.75,
        source: "static_finding",
        adapterHint: adapterId,
        metadata: {
          staticFindingId: finding.id,
          ruleId: finding.ruleId,
          filePath: finding.filePath,
          adapterHint: adapterId,
          routeMappable: mapping.testable,
          ...(input.requireMappedRoutes && mapping.testable ? { fixtures: mapping.fixtures } : {}),
          ...(input.requireMappedRoutes && !mapping.testable
            ? { notSafelyTestableReason: mapping.reason }
            : {}),
        },
      });
    }
  }

  if (
    input.requireMappedRoutes &&
    selected.has("security-headers-probe") &&
    !hypotheses.some((hypothesis) => hypothesis.adapterHint === "security-headers-probe")
  ) {
    const adapterId = "security-headers-probe";
    for (const finding of input.staticFindings) {
      const mapping = mapFindingToDynamicFixtures({ finding, adapterId });
      if (!mapping.testable) continue;
      const adapter = ATTACK_ADAPTER_CATALOG.find((entry) => entry.id === adapterId);
      const friendly = friendlyTestCopy(adapterId, input.t);
      hypotheses.push({
        id: `${finding.id}:${adapterId}`,
        title: friendly.title || adapter?.title || adapterId,
        description: friendly.description || adapter?.description || "",
        category: adapter?.category ?? "web",
        severity: "info",
        confidence: 0.9,
        source: "repository_route",
        adapterHint: adapterId,
        metadata: {
          staticFindingId: finding.id,
          ruleId: finding.ruleId,
          filePath: finding.filePath,
          adapterHint: adapterId,
          routeMappable: true,
          fixtures: mapping.fixtures,
        },
      });
      break;
    }
  }

  if (hypotheses.length === 0 && !input.requireMappedRoutes) {
    for (const adapterId of selected) {
      const adapter = ATTACK_ADAPTER_CATALOG.find((entry) => entry.id === adapterId);
      const friendly = friendlyTestCopy(adapterId, input.t);
      hypotheses.push({
        id: adapterId,
        title: friendly.title || adapter?.title || adapterId,
        description: friendly.description || adapter?.description || "",
        category: adapter?.category ?? "general",
        severity: "medium",
        confidence: 0.7,
        source: "security_test.catalog",
        adapterHint: adapterId,
        metadata: { adapterHint: adapterId },
      });
    }
  }

  return { hypotheses, notSafelyTestableCount };
}
