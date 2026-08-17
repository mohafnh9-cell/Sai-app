import { AGENT_ACTION_SKIP_DIRS } from "./constants";
import { scanAgentActionFile, dedupeAgentActionFindings } from "./scan-file";
import type { AgentScanResult } from "./types";

export type RepositoryFile = {
  path: string;
  content: string;
};

function shouldSkipPath(path: string): boolean {
  return path.split("/").some((segment) => AGENT_ACTION_SKIP_DIRS.has(segment));
}

function isScannableFile(path: string): boolean {
  return /\.(js|jsx|ts|tsx|py|json)$/i.test(path);
}

export function scanAgentActionRepository(files: RepositoryFile[]): AgentScanResult {
  const findings = [];
  let filesScanned = 0;
  let filesConsidered = 0;

  for (const file of files) {
    if (shouldSkipPath(file.path)) continue;
    if (!isScannableFile(file.path)) continue;
    filesConsidered += 1;

    const fileFindings = scanAgentActionFile(file.path, file.content);
    if (fileFindings.length > 0) {
      filesScanned += 1;
      findings.push(...fileFindings);
    }
  }

  return {
    findings: dedupeAgentActionFindings(findings),
    filesScanned,
    filesConsidered,
  };
}
