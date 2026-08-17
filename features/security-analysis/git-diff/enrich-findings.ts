import type { FindingDraft } from "@/features/security-scanner/types";
import type { SecurityAnalysisFinding } from "../schema";
import { classifyFindingDiffRelationship } from "./classify-relationship";
import {
  buildParsedDiffFromChangedPaths,
  parseUnifiedDiff,
} from "./parse-unified-diff";
import type { DiffEnrichmentResult, DiffInput } from "./types";

function parseDiffInput(input: DiffInput) {
  if (input.kind === "unified") {
    return parseUnifiedDiff(input.diff);
  }
  return buildParsedDiffFromChangedPaths({
    changedPaths: input.changedPaths,
    renames: input.renames,
  });
}

export function enrichSecurityFindingsWithDiffContext(
  findings: SecurityAnalysisFinding[],
  diffInput: DiffInput
): DiffEnrichmentResult {
  const parsedDiff = parseDiffInput(diffInput);
  const hasLineLevelDiff = diffInput.kind === "unified" && parsedDiff.files.some((file) => file.hunks.length > 0);

  const enriched = findings.map((finding) => {
    const diffContext = classifyFindingDiffRelationship({
      file: finding.file,
      line: finding.line,
      parsedDiff,
      hasLineLevelDiff,
    });

    return {
      ...finding,
      metadata: {
        ...(finding.metadata ?? {}),
        diffContext,
      },
    };
  });

  const summary = {
    total: enriched.length,
    introduced: enriched.filter((finding) => finding.metadata?.diffContext?.status === "introduced").length,
    affected: enriched.filter((finding) => finding.metadata?.diffContext?.status === "affected").length,
    preExisting: enriched.filter((finding) => finding.metadata?.diffContext?.status === "pre_existing").length,
    unrelated: enriched.filter((finding) => finding.metadata?.diffContext?.status === "unrelated").length,
    unknown: enriched.filter((finding) => finding.metadata?.diffContext?.status === "unknown").length,
  };

  return { findings: enriched, summary };
}

export function enrichFindingDraftsWithDiffContext(
  drafts: FindingDraft[],
  diffInput: DiffInput
): FindingDraft[] {
  const parsedDiff = parseDiffInput(diffInput);
  const hasLineLevelDiff = diffInput.kind === "unified" && parsedDiff.files.some((file) => file.hunks.length > 0);

  return drafts.map((draft) => {
    const diffContext = classifyFindingDiffRelationship({
      file: draft.location?.path ?? null,
      line: draft.location?.line ?? null,
      parsedDiff,
      hasLineLevelDiff,
    });

    return {
      ...draft,
      metadata: {
        ...(draft.metadata ?? {}),
        diffContext,
      },
    };
  });
}

export function enrichFindingsWithDiffContext<
  T extends {
    location: { path: string; line: number };
    metadata?: Record<string, unknown>;
  },
>(findings: T[], diffInput: DiffInput): T[] {
  const parsedDiff = parseDiffInput(diffInput);
  const hasLineLevelDiff =
    diffInput.kind === "unified" && parsedDiff.files.some((file) => file.hunks.length > 0);

  return findings.map((finding) => ({
    ...finding,
    metadata: {
      ...(finding.metadata ?? {}),
      diffContext: classifyFindingDiffRelationship({
        file: finding.location.path,
        line: finding.location.line,
        parsedDiff,
        hasLineLevelDiff,
      }),
    },
  }));
}
