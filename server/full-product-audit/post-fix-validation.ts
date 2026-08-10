import type { ConsolidatedAuditFinding, PostFixStatus } from "./types";

function findingKey(finding: ConsolidatedAuditFinding): string {
  return finding.ruleId ?? finding.staticFindingId ?? finding.id;
}

export function compareAuditForPostFix(input: {
  before: ConsolidatedAuditFinding[];
  after: ConsolidatedAuditFinding[];
  targetRuleIds?: readonly string[];
  targetStaticFindingIds?: readonly string[];
}): PostFixStatus {
  const targetRules = new Set((input.targetRuleIds ?? []).map((id) => id.toLowerCase()));
  const targetStatic = new Set(input.targetStaticFindingIds ?? []);

  const beforeRelevant = input.before.filter((finding) => {
    if (targetStatic.size > 0 && finding.staticFindingId && targetStatic.has(finding.staticFindingId)) {
      return true;
    }
    if (targetRules.size > 0 && finding.ruleId && targetRules.has(finding.ruleId.toLowerCase())) {
      return true;
    }
    return targetRules.size === 0 && targetStatic.size === 0;
  });

  if (beforeRelevant.length === 0) return "NOT_VERIFIED";

  const afterByKey = new Map(input.after.map((finding) => [findingKey(finding), finding]));
  let fixed = 0;
  let stillVulnerable = 0;
  let regression = 0;

  for (const beforeFinding of beforeRelevant) {
    const key = findingKey(beforeFinding);
    const afterFinding = afterByKey.get(key);

    if (!afterFinding) {
      fixed += 1;
      continue;
    }

    const beforeConfirmed =
      beforeFinding.verificationStatus === "CONFIRMED" ||
      beforeFinding.verificationStatus === "LIKELY";
    const afterConfirmed =
      afterFinding.verificationStatus === "CONFIRMED" ||
      afterFinding.verificationStatus === "LIKELY";

    if (beforeConfirmed && afterConfirmed) {
      stillVulnerable += 1;
    } else if (!beforeConfirmed && afterConfirmed) {
      regression += 1;
    } else if (beforeConfirmed && !afterConfirmed) {
      fixed += 1;
    } else if (
      beforeFinding.verificationStatus === "POTENTIAL" &&
      afterFinding.verificationStatus === "NOT_APPLICABLE"
    ) {
      fixed += 1;
    } else if (
      beforeFinding.verificationStatus === "POTENTIAL" &&
      (afterFinding.verificationStatus === "POTENTIAL" ||
        afterFinding.verificationStatus === "NOT_REPRODUCED")
    ) {
      stillVulnerable += 1;
    }
  }

  if (regression > 0) return "REGRESSION";
  if (stillVulnerable > 0) return "STILL_VULNERABLE";
  if (fixed > 0) return "FIXED";
  return "NOT_VERIFIED";
}

export function annotatePostFixStatus(
  findings: ConsolidatedAuditFinding[],
  status: PostFixStatus
): ConsolidatedAuditFinding[] {
  return findings.map((finding) => ({ ...finding, postFixStatus: status }));
}
