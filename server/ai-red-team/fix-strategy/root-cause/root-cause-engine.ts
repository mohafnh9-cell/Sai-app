import { randomUUID } from "node:crypto";
import type { RootCause, RootCauseKind } from "../fix-strategy.types";
import type { AttackFinding } from "../../types";

type CauseRule = {
  rootCauseId: string;
  title: string;
  description: string;
  kind: RootCauseKind;
  match: (finding: AttackFinding) => boolean;
};

const RULES: CauseRule[] = [
  {
    rootCauseId: "rc.session_auth",
    title: "Weak or reusable session and token handling",
    description: "Authentication boundaries do not consistently invalidate or scope credentials.",
    kind: "architectural",
    match: (f) =>
      /session|jwt|token|cookie|auth/i.test(f.title) ||
      f.domain === "authentication" ||
      String(f.metadata?.category ?? "").includes("session"),
  },
  {
    rootCauseId: "rc.authorization_boundary",
    title: "Missing centralized authorization enforcement",
    description: "Object, function, and tenant checks are inconsistent across routes and data access.",
    kind: "architectural",
    match: (f) =>
      f.domain === "authorization" ||
      /tenant|ownership|bola|bfla|admin|privilege|authorization/i.test(f.title) ||
      /tenant|ownership|privilege|admin|authz/i.test(String(f.metadata?.category ?? "")),
  },
  {
    rootCauseId: "rc.business_logic",
    title: "Business workflow trust assumptions",
    description: "Server-side invariants for workflows, limits, or state transitions are incomplete.",
    kind: "developer_mistake",
    match: (f) =>
      f.domain === "payments" ||
      /business|workflow|race|limit|coupon|subscription/i.test(f.title) ||
      String(f.metadata?.category ?? "").includes("business"),
  },
  {
    rootCauseId: "rc.llm_controls",
    title: "Insufficient LLM input/output controls",
    description: "Prompt injection and data exfiltration paths are not constrained at the model boundary.",
    kind: "framework",
    match: (f) =>
      f.domain === "llm" ||
      /prompt|injection|llm|model/i.test(f.title) ||
      String(f.metadata?.category ?? "").includes("llm"),
  },
  {
    rootCauseId: "rc.api_hardening",
    title: "API surface hardening gaps",
    description: "Validation, error handling, or access rules on API endpoints are inconsistent.",
    kind: "configuration",
    match: (f) =>
      f.domain === "api" ||
      /api|cors|error|validation|rate/i.test(f.title) ||
      Boolean(f.metadata?.route),
  },
  {
    rootCauseId: "rc.client_exposure",
    title: "Client-side exposure of sensitive context",
    description: "Browser-visible assets or storage leak credentials or authorization context.",
    kind: "configuration",
    match: (f) => f.domain === "browser" || /xss|storage|client|browser/i.test(f.title),
  },
];

const FALLBACK: Omit<CauseRule, "match"> = {
  rootCauseId: "rc.general_hardening",
  title: "Defense-in-depth gaps",
  description: "Multiple low-level controls fail to compose into a coherent security posture.",
  kind: "shared",
};

export function analyzeRootCauses(findings: AttackFinding[]): RootCause[] {
  const buckets = new Map<string, { rule: Omit<CauseRule, "match">; findingIds: string[] }>();

  for (const finding of findings) {
    const rule = RULES.find((r) => r.match(finding)) ?? FALLBACK;
    const bucket = buckets.get(rule.rootCauseId) ?? { rule, findingIds: [] };
    bucket.findingIds.push(finding.id);
    buckets.set(rule.rootCauseId, bucket);
  }

  const causes: RootCause[] = [...buckets.values()].map(({ rule, findingIds }) => ({
    rootCauseId: rule.rootCauseId,
    title: rule.title,
    description: rule.description,
    kind: rule.kind,
    findingIds: [...new Set(findingIds)],
    sharedWith: [],
  }));

  for (const cause of causes) {
    cause.sharedWith = causes
      .filter((c) => c.rootCauseId !== cause.rootCauseId)
      .filter((c) => c.kind === cause.kind || c.kind === "architectural")
      .map((c) => c.rootCauseId);
  }

  return causes.sort((a, b) => b.findingIds.length - a.findingIds.length);
}

export function dedupeRootCauses(causes: RootCause[]): RootCause[] {
  const seen = new Set<string>();
  const out: RootCause[] = [];
  for (const cause of causes) {
    const key = cause.rootCauseId;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cause);
  }
  return out;
}

export function assignUnmappedFindings(causes: RootCause[], findingIds: string[]): RootCause[] {
  const mapped = new Set(causes.flatMap((c) => c.findingIds));
  const unmapped = findingIds.filter((id) => !mapped.has(id));
  if (unmapped.length === 0) return causes;
  const fallback = causes.find((c) => c.rootCauseId === FALLBACK.rootCauseId);
  if (fallback) {
    fallback.findingIds.push(...unmapped);
    return causes;
  }
  return [
    ...causes,
    {
      rootCauseId: FALLBACK.rootCauseId,
      title: FALLBACK.title,
      description: FALLBACK.description,
      kind: FALLBACK.kind,
      findingIds: unmapped,
      sharedWith: [],
    },
  ];
}

export function synthesizeRootCauseId(): string {
  return `rc.${randomUUID().slice(0, 8)}`;
}
