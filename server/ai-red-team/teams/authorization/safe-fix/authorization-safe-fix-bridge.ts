import type { AuthzFindingRecord } from "../findings/authorization-finding";

export type AuthzSafeFixCandidate = {
  groupKey: string;
  title: string;
  findingIds: string[];
  cursorPrompt: string;
};

export function buildAuthzSafeFixCandidates(findings: AuthzFindingRecord[]): AuthzSafeFixCandidate[] {
  const eligible = findings.filter((f) => f.safeFixEligible && f.status !== "duplicate");
  const byCategory = new Map<string, AuthzFindingRecord[]>();
  for (const f of eligible) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }

  const prompts: Record<string, string> = {
    tenant_isolation_failure: "Enforce organization/tenant filter on all data access paths.",
    broken_object_authorization: "Validate resource ownership before update/delete.",
    broken_rls: "Add or enable RLS policies for tenant-scoped tables.",
    privilege_escalation: "Centralize authorization and deny role elevation without admin approval.",
    broken_function_authorization: "Restrict admin middleware to admin roles only.",
    policy_conflict: "Resolve conflicting authorization rules in middleware and database policies.",
  };

  return [...byCategory.entries()].map(([category, group]) => ({
    groupKey: category,
    title: group[0]?.title ?? category,
    findingIds: group.map((g) => g.findingId),
    cursorPrompt:
      prompts[category] ??
      group[0]?.remediationDirection ??
      "Centralize authorization checks for this resource.",
  }));
}
