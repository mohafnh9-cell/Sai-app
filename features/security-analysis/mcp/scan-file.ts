import { findSpoofedTool } from "./spoofing";
import { MCP_SECURITY_RULES } from "./rules";
import type { McpRawFinding } from "./types";

function extensionForPath(path: string): string {
  const index = path.lastIndexOf(".");
  return index >= 0 ? path.slice(index).toLowerCase() : "";
}

export function scanMcpFileContent(filePath: string, content: string): McpRawFinding[] {
  const ext = extensionForPath(filePath);
  const lines = content.split("\n");
  const findings: McpRawFinding[] = [];

  for (const rule of MCP_SECURITY_RULES) {
    if (!rule.fileTypes.includes(ext)) continue;

    const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const upToMatch = content.slice(0, match.index);
      const lineNumber = upToMatch.split("\n").length;
      const lineIndex = lineNumber - 1;

      if (rule.contextCheck) {
        const line = lines[lineIndex] ?? "";
        if (!rule.contextCheck(line, lines, lineIndex)) {
          continue;
        }
      }

      if (rule.isSpoofingRule) {
        const toolName = match[1];
        if (!toolName) continue;
        const spoof = findSpoofedTool(toolName);
        if (!spoof) continue;
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          category: rule.category,
          message: `Tool name "${toolName}" is ${spoof.distance} edit(s) away from well-known tool "${spoof.spoofed}". This may be a spoofing attack.`,
          file: filePath,
          line: lineNumber,
          match: match[0].slice(0, 100),
        });
        continue;
      }

      findings.push({
        rule: rule.id,
        severity: rule.severity,
        category: rule.category,
        message: rule.message,
        file: filePath,
        line: lineNumber,
        match: match[0].slice(0, 100),
      });
    }
  }

  return findings;
}

export function dedupeMcpFindings(findings: McpRawFinding[]): McpRawFinding[] {
  const seen = new Set<string>();
  const deduped: McpRawFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}:${finding.file}:${finding.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
