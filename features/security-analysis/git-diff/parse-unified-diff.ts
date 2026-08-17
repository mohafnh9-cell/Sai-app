import type { ParsedDiff, ParsedDiffFile, ParsedDiffHunk, ParsedDiffLine } from "./types";

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^(a|b)\//, "").trim();
}

function parsePathHeader(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "/dev/null") return null;
  return normalizePath(trimmed);
}

function finalizeFile(file: Partial<ParsedDiffFile> & { hunks: ParsedDiffHunk[] }): ParsedDiffFile {
  const addedLines = file.addedLines ?? new Set<number>();
  const deletedLines = file.deletedLines ?? new Set<number>();
  const modifiedNewLines = file.modifiedNewLines ?? new Set<number>();
  const modifiedOldLines = file.modifiedOldLines ?? new Set<number>();

  for (const hunk of file.hunks) {
    for (let index = 0; index < hunk.lines.length - 1; index += 1) {
      const current = hunk.lines[index];
      const next = hunk.lines[index + 1];
      if (current?.type === "deleted" && next?.type === "added" && current.oldLine != null && next.newLine != null) {
        modifiedOldLines.add(current.oldLine);
        modifiedNewLines.add(next.newLine);
        addedLines.delete(next.newLine);
      }
    }
  }

  let status = file.status ?? "modified";
  if (!file.oldPath && file.newPath) status = "added";
  if (file.oldPath && !file.newPath) status = "deleted";
  if (file.oldPath && file.newPath && file.oldPath !== file.newPath) status = "renamed";

  return {
    oldPath: file.oldPath ?? null,
    newPath: file.newPath ?? null,
    status,
    hunks: file.hunks,
    addedLines,
    deletedLines,
    modifiedNewLines,
    modifiedOldLines,
  };
}

function pushHunkLine(
  file: Partial<ParsedDiffFile>,
  hunk: ParsedDiffHunk,
  line: ParsedDiffLine,
  counters: { oldLine: number; newLine: number }
): void {
  hunk.lines.push(line);
  if (line.type === "context") {
    counters.oldLine += 1;
    counters.newLine += 1;
    return;
  }
  if (line.type === "deleted" && line.oldLine != null) {
    file.deletedLines?.add(line.oldLine);
    counters.oldLine += 1;
    return;
  }
  if (line.type === "added" && line.newLine != null) {
    file.addedLines?.add(line.newLine);
    counters.newLine += 1;
  }
}

export function parseUnifiedDiff(diff: string): ParsedDiff {
  const files: ParsedDiffFile[] = [];
  const renames = new Map<string, string>();
  const changedPaths = new Set<string>();

  if (!diff.trim()) {
    return { files, renames, changedPaths };
  }

  let current: (Partial<ParsedDiffFile> & { hunks: ParsedDiffHunk[] }) | null = null;
  let currentHunk: ParsedDiffHunk | null = null;
  const counters = { oldLine: 0, newLine: 0 };

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      if (current) {
        files.push(finalizeFile(current));
      }
      current = {
        hunks: [],
        addedLines: new Set<number>(),
        deletedLines: new Set<number>(),
        modifiedNewLines: new Set<number>(),
        modifiedOldLines: new Set<number>(),
      };
      currentHunk = null;
      continue;
    }

    if (!current) continue;

    if (rawLine.startsWith("rename from ")) {
      current.oldPath = normalizePath(rawLine.slice("rename from ".length));
      current.status = "renamed";
      continue;
    }
    if (rawLine.startsWith("rename to ")) {
      current.newPath = normalizePath(rawLine.slice("rename to ".length));
      current.status = "renamed";
      continue;
    }
    if (rawLine.startsWith("--- ")) {
      current.oldPath = parsePathHeader(rawLine.slice(4));
      continue;
    }
    if (rawLine.startsWith("+++ ")) {
      current.newPath = parsePathHeader(rawLine.slice(4));
      continue;
    }

    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      counters.oldLine = Number.parseInt(hunkMatch[1] ?? "0", 10);
      counters.newLine = Number.parseInt(hunkMatch[3] ?? "0", 10);
      currentHunk = {
        header: rawLine,
        oldStart: counters.oldLine,
        oldCount: Number.parseInt(hunkMatch[2] ?? "1", 10),
        newStart: counters.newLine,
        newCount: Number.parseInt(hunkMatch[4] ?? "1", 10),
        lines: [],
      };
      current.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || rawLine.length === 0) continue;

    const prefix = rawLine[0];
    const content = rawLine.slice(1);
    if (prefix === " ") {
      pushHunkLine(
        current,
        currentHunk,
        { type: "context", oldLine: counters.oldLine, newLine: counters.newLine, content },
        counters
      );
      continue;
    }
    if (prefix === "-") {
      pushHunkLine(
        current,
        currentHunk,
        { type: "deleted", oldLine: counters.oldLine, newLine: null, content },
        counters
      );
      continue;
    }
    if (prefix === "+") {
      pushHunkLine(
        current,
        currentHunk,
        { type: "added", oldLine: null, newLine: counters.newLine, content },
        counters
      );
    }
  }

  if (current) {
    files.push(finalizeFile(current));
  }

  for (const file of files) {
    if (file.oldPath && file.newPath && file.oldPath !== file.newPath) {
      renames.set(file.oldPath, file.newPath);
      changedPaths.add(file.oldPath);
      changedPaths.add(file.newPath);
      continue;
    }
    if (file.newPath) changedPaths.add(file.newPath);
    if (file.oldPath) changedPaths.add(file.oldPath);
  }

  return { files, renames, changedPaths };
}

export function buildParsedDiffFromChangedPaths(input: {
  changedPaths: string[];
  renames?: Array<{ from: string; to: string }>;
}): ParsedDiff {
  const renames = new Map<string, string>();
  for (const rename of input.renames ?? []) {
    renames.set(normalizePath(rename.from), normalizePath(rename.to));
  }

  const files: ParsedDiffFile[] = input.changedPaths.map((path) => {
    const normalized = normalizePath(path);
    const renamedTo = renames.get(normalized);
    return {
      oldPath: renamedTo ? normalized : normalized,
      newPath: renamedTo ?? normalized,
      status: renamedTo ? "renamed" : "modified",
      hunks: [],
      addedLines: new Set<number>(),
      deletedLines: new Set<number>(),
      modifiedNewLines: new Set<number>(),
      modifiedOldLines: new Set<number>(),
    };
  });

  return {
    files,
    renames,
    changedPaths: new Set(input.changedPaths.map(normalizePath)),
  };
}

export function resolveFindingPath(path: string, parsed: ParsedDiff): string {
  const normalized = normalizePath(path);
  if (parsed.renames.has(normalized)) {
    return parsed.renames.get(normalized)!;
  }
  for (const [from, to] of parsed.renames) {
    if (to === normalized) return to;
    if (from === normalized) return to;
  }
  return normalized;
}

export function findDiffFile(path: string, parsed: ParsedDiff): ParsedDiffFile | null {
  const resolved = resolveFindingPath(path, parsed);
  for (const file of parsed.files) {
    if (file.newPath === resolved || file.oldPath === resolved) {
      return file;
    }
  }
  if (parsed.changedPaths.has(resolved)) {
    return {
      oldPath: resolved,
      newPath: resolved,
      status: "modified",
      hunks: [],
      addedLines: new Set<number>(),
      deletedLines: new Set<number>(),
      modifiedNewLines: new Set<number>(),
      modifiedOldLines: new Set<number>(),
    };
  }
  return null;
}

export function collectChangedNewLines(file: ParsedDiffFile): number[] {
  return [
    ...file.addedLines,
    ...file.modifiedNewLines,
  ].sort((a, b) => a - b);
}

export function hunkContextForLine(file: ParsedDiffFile, line: number): string | undefined {
  for (const hunk of file.hunks) {
    const newLines = hunk.lines
      .filter((entry) => entry.newLine != null)
      .map((entry) => entry.newLine as number);
    if (newLines.length === 0) continue;
    const min = Math.min(...newLines);
    const max = Math.max(...newLines);
    if (line >= min && line <= max) {
      return hunk.lines.map((entry) => `${entry.type === "added" ? "+" : entry.type === "deleted" ? "-" : " "}${entry.content}`).join("\n");
    }
  }
  return undefined;
}

export function normalizeDiffPath(path: string): string {
  return normalizePath(path);
}
