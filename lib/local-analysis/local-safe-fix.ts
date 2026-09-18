import {
  buildProductionFixPrompt,
  fixPromptInputFromFinding,
  formatEstimatedFixTime,
  projectedScoreAfterFix,
  projectedVerdictStatusAfterFix,
} from "@/brain/fix-prompt";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { correlationKeyForPersistedFinding } from "./finding-history";
import type { LocalPersistenceStore, PersistedFinding, PersistedScan } from "./local-persistence";

/**
 * L1.7/L1.8 -- "explain this finding" and "give me a safe fix for it",
 * scoped to a single local workspace's own latest persisted scan.
 *
 * This is NOT a second fix-prompt engine: it delegates the actual prompt
 * assembly to brain/fix-prompt (buildProductionFixPrompt/
 * fixPromptInputFromFinding) -- the exact same deterministic, no-AI, no-DB
 * engine server/mcp/tools/safe-fix.ts already uses for the GitHub-connected
 * product. That module already enforces "no credentials in the prompt"
 * (server/mcp/security's sanitizeProductionFixPromptInput/
 * assertFixPromptOutputSafe run inside buildProductionFixPrompt itself), so
 * this file does not duplicate that guard -- it only supplies the local
 * finding data.
 *
 * server/safe-fix-engine (SafeFixRecord/PR drafts/lifecycle states/
 * organization-scoped DB persistence) is a SEPARATE, heavier system for the
 * GitHub-connected product's tracked fix workflow. It is not reused here:
 * its shape assumes an organizationId/reviewId/Postgres row that has no
 * local equivalent, and building one would be exactly the "second
 * architecture" this phase is told not to create. The local loop's
 * equivalent of "was this fix verified" is simply: rescan (sequrai_local_
 * audit again) and read the resulting finding-history lifecycle -- already
 * built in L1.6, reused unchanged here (see loadCurrentFindingsForFix,
 * which never recomputes lifecycle, only reads the latest persisted scan).
 *
 * SAFE_FIX DOES NOT EXECUTE CODE: this module returns a prompt string for a
 * human/agent to review and apply -- it has no filesystem-write, no git,
 * and no subprocess capability at all.
 */

export class LocalSafeFixError extends Error {
  constructor(
    public readonly code: "no_scan_yet" | "finding_not_found",
    message: string
  ) {
    super(message);
    this.name = "LocalSafeFixError";
  }
}

export type LocalFixCandidate = {
  correlationKey: string;
  ruleId: string;
  title: string;
  severity: string | null;
  filePath: string | null;
};

export type LocalSafeFixResult =
  | {
      status: "no_findings";
      scanId: string;
      note: string;
    }
  | {
      status: "choose_finding";
      scanId: string;
      candidates: LocalFixCandidate[];
      note: string;
    }
  | {
      status: "prompt_ready";
      scanId: string;
      finding: LocalFixCandidate;
      fixPrompt: string;
      safeFixConfidence: number;
      implementationRisk: string;
      estimatedFixTime: string;
      projectedScore: number;
      projectedVerdict: string;
      note: string;
    };

const MAX_FIX_CANDIDATES = 8;
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/**
 * Loads the current findings this workspace's own latest persisted scan
 * produced. `identity` is always derived from the caller's resolved,
 * boundary-checked workspace path (see local-tool-handlers.ts's
 * resolveLocalWorkspacePath) -- never accepted as a caller-supplied
 * override -- so a request against workspace A structurally cannot read
 * workspace B's scans. The repositoryId equality check below is
 * defense-in-depth on top of that (see finding-history.ts's own comment on
 * why this is close to redundant given one SQLite file per workspace, but
 * still explicit rather than assumed).
 */
export function loadCurrentFindingsForFix(
  store: LocalPersistenceStore,
  identity: { workspaceId: string; repositoryId: string }
): { scan: PersistedScan; findings: PersistedFinding[] } {
  const scan = store.getLatestScan(identity.workspaceId);
  if (!scan || scan.repositoryId !== identity.repositoryId) {
    throw new LocalSafeFixError(
      "no_scan_yet",
      "No local scan has been recorded for this workspace yet. Run sequrai_local_audit (or audit_local_project) first."
    );
  }
  return { scan, findings: store.getFindingsForScan(scan.scanId) };
}

function toCandidate(finding: PersistedFinding, correlationKey: string): LocalFixCandidate {
  return {
    correlationKey,
    ruleId: finding.rule_id ?? "",
    title: finding.title,
    severity: finding.severity ?? null,
    filePath: finding.file_path ?? null,
  };
}

/**
 * "What's wrong, and how do I fix it?" for one specific finding, identified
 * by correlationKey -- the SAME identity finding-history.ts's lifecycle
 * already uses (never a second identity scheme, never a raw persisted row
 * id, which local-persistence.ts synthesizes per-scan and does not survive
 * across scans the way correlationKey does).
 *
 * Deterministic evidence stays authoritative: every field in the returned
 * fix prompt (title, severity, file, evidence, recommendation) comes
 * straight from the persisted finding row -- this function invents nothing,
 * calls no AI, and cannot fabricate a finding that was not actually
 * detected.
 */
export function buildLocalSafeFix(
  store: LocalPersistenceStore,
  identity: { workspaceId: string; repositoryId: string; projectName?: string },
  input: { correlationKey?: string }
): LocalSafeFixResult {
  const { scan, findings } = loadCurrentFindingsForFix(store, identity);
  const verdict = store.getVerdictForScan(scan.scanId);

  const candidates = findings
    .map((finding) => ({ finding, correlationKey: correlationKeyForPersistedFinding(finding, identity.workspaceId) }))
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.finding.severity ?? ""] ?? 5) - (SEVERITY_RANK[b.finding.severity ?? ""] ?? 5) ||
        a.correlationKey.localeCompare(b.correlationKey)
    );

  if (candidates.length === 0) {
    return {
      status: "no_findings",
      scanId: scan.scanId,
      note: "No findings in the latest scan -- nothing to fix.",
    };
  }

  const requested = input.correlationKey?.trim();
  if (!requested) {
    return {
      status: "choose_finding",
      scanId: scan.scanId,
      candidates: candidates.slice(0, MAX_FIX_CANDIDATES).map((c) => toCandidate(c.finding, c.correlationKey)),
      note: "Pass one of these correlationKey values as `correlationKey` to get a fix prompt for that specific finding.",
    };
  }

  const match = candidates.find((c) => c.correlationKey === requested);
  if (!match) {
    throw new LocalSafeFixError(
      "finding_not_found",
      `No finding with correlationKey "${requested}" was found in the latest scan (${scan.scanId}) for this workspace.`
    );
  }

  const promptInput = fixPromptInputFromFinding(
    {
      id: match.finding.id,
      title: match.finding.title,
      severity: match.finding.severity ?? undefined,
      category: match.finding.category ?? undefined,
      rule_id: match.finding.rule_id ?? undefined,
      file_path: match.finding.file_path ?? undefined,
      start_line: match.finding.start_line ?? undefined,
      recommendation: match.finding.recommendation ?? undefined,
      evidence: match.finding.evidence ?? undefined,
    },
    {
      projectName: identity.projectName,
      currentVerdictStatus: verdict?.status as VerdictStatus | undefined,
      currentScore: verdict?.score ?? null,
    }
  );

  const result = buildProductionFixPrompt(promptInput);

  return {
    status: "prompt_ready",
    scanId: scan.scanId,
    finding: toCandidate(match.finding, match.correlationKey),
    fixPrompt: result.prompt,
    safeFixConfidence: result.assessment.safeFixConfidence,
    implementationRisk: result.assessment.implementationRisk,
    estimatedFixTime: formatEstimatedFixTime(promptInput.estimatedFixMinutes),
    projectedScore: projectedScoreAfterFix(promptInput),
    projectedVerdict: projectedVerdictStatusAfterFix(promptInput),
    note:
      "SequrAI does not execute this fix. Review and apply it yourself, then run sequrai_local_audit (or audit_local_project) again -- the rescan's finding history will show this finding as RESOLVED if it is no longer detected in a complete scan, or PERSISTING if it still is. \"Resolved\" means not detected in the latest complete scan, not proven fixed or secure.",
  };
}
