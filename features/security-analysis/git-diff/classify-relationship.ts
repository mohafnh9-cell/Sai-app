import {
  findDiffFile,
  hunkContextForLine,
  resolveFindingPath,
} from "./parse-unified-diff";
import type { DiffContext, DiffRelationshipStatus, ParsedDiff } from "./types";

type DiffRelevance = DiffContext["relevance"];

function buildContext(
  status: DiffRelationshipStatus,
  overrides: Partial<DiffContext> = {}
): DiffContext {
  return {
    status,
    changed: false,
    introduced: false,
    affected: false,
    preExisting: false,
    relevance: "none",
    changedLines: [],
    ...overrides,
  };
}

export function classifyFindingDiffRelationship(input: {
  file: string | null | undefined;
  line: number | null | undefined;
  parsedDiff: ParsedDiff;
  hasLineLevelDiff?: boolean;
}): DiffContext {
  const { file, line, parsedDiff } = input;
  const hasLineLevelDiff =
    input.hasLineLevelDiff ??
    parsedDiff.files.some((entry) => entry.hunks.length > 0 || entry.addedLines.size > 0);

  if (!file?.trim()) {
    return buildContext("unknown");
  }

  const matchedPath = resolveFindingPath(file, parsedDiff);
  const diffFile = findDiffFile(file, parsedDiff);
  if (!diffFile) {
    return buildContext("unrelated", { matchedPath });
  }

  if (line == null || !Number.isFinite(line) || line <= 0) {
    return buildContext("unknown", {
      matchedPath,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      changed: true,
      affected: true,
      relevance: "low",
    });
  }

  if (diffFile.status === "deleted") {
    if (diffFile.deletedLines.has(line) || diffFile.modifiedOldLines.has(line)) {
      return buildContext("pre_existing", {
        matchedPath,
        oldPath: diffFile.oldPath,
        newPath: diffFile.newPath,
        changed: true,
        preExisting: true,
        removedByChange: true,
        relevance: "low",
        deletedLines: [line],
        hunkContext: hunkContextForLine(diffFile, line),
      });
    }
    return buildContext("affected", {
      matchedPath,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      changed: true,
      affected: true,
      relevance: "medium",
    });
  }

  if (!hasLineLevelDiff) {
    return buildContext("affected", {
      matchedPath,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      changed: true,
      affected: true,
      relevance: "medium",
    });
  }

  if (diffFile.addedLines.has(line) || diffFile.modifiedNewLines.has(line)) {
    return buildContext("introduced", {
      matchedPath,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      changed: true,
      introduced: true,
      relevance: "high",
      changedLines: [line],
      hunkContext: hunkContextForLine(diffFile, line),
    });
  }

  if (diffFile.deletedLines.has(line) || diffFile.modifiedOldLines.has(line)) {
    return buildContext("pre_existing", {
      matchedPath,
      oldPath: diffFile.oldPath,
      newPath: diffFile.newPath,
      changed: true,
      preExisting: true,
      removedByChange: true,
      relevance: "low",
      deletedLines: [line],
      hunkContext: hunkContextForLine(diffFile, line),
    });
  }

  return buildContext("pre_existing", {
    matchedPath,
    oldPath: diffFile.oldPath,
    newPath: diffFile.newPath,
    changed: false,
    preExisting: true,
    relevance: "low",
  });
}

export function diffRelevanceForStatus(status: DiffRelationshipStatus): DiffRelevance {
  switch (status) {
    case "introduced":
      return "high";
    case "affected":
      return "medium";
    case "pre_existing":
      return "low";
    case "unrelated":
      return "none";
    default:
      return "low";
  }
}
