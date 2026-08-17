export type DiffLineType = "added" | "deleted" | "context";

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export type DiffRelationshipStatus =
  | "introduced"
  | "affected"
  | "pre_existing"
  | "unrelated"
  | "unknown";

export type DiffRelevance = "high" | "medium" | "low" | "none";

export type ParsedDiffLine = {
  type: DiffLineType;
  oldLine: number | null;
  newLine: number | null;
  content: string;
};

export type ParsedDiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: ParsedDiffLine[];
};

export type ParsedDiffFile = {
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  hunks: ParsedDiffHunk[];
  addedLines: Set<number>;
  deletedLines: Set<number>;
  modifiedNewLines: Set<number>;
  modifiedOldLines: Set<number>;
};

export type ParsedDiff = {
  files: ParsedDiffFile[];
  renames: Map<string, string>;
  changedPaths: Set<string>;
};

export type DiffContext = {
  status: DiffRelationshipStatus;
  changed: boolean;
  introduced: boolean;
  affected: boolean;
  preExisting: boolean;
  relevance: DiffRelevance;
  changedLines: number[];
  deletedLines?: number[];
  hunkContext?: string;
  matchedPath?: string;
  oldPath?: string | null;
  newPath?: string | null;
  removedByChange?: boolean;
};

export type DiffInput =
  | { kind: "unified"; diff: string }
  | {
      kind: "paths";
      changedPaths: string[];
      renames?: Array<{ from: string; to: string }>;
    };

export type DiffEnrichmentResult = {
  findings: import("../schema").SecurityAnalysisFinding[];
  summary: {
    total: number;
    introduced: number;
    affected: number;
    preExisting: number;
    unrelated: number;
    unknown: number;
  };
};
