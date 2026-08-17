import {
  checkAgentAction,
  severityToConfidence,
} from "./action-checks";
import {
  categoryForActionType,
  discoverAgentTools,
  extractActionValues,
  handlerHasValidation,
  handlerUsesUserInput,
  inferActionTypeFromToolName,
  inferActionTypesFromHandler,
  isAgentRelatedPath,
} from "./discover";
import { AGENT_TOOL_DEFINITION_MARKERS } from "./constants";
import type {
  AgentActionCheckFinding,
  AgentActionRawFinding,
  AgentActionTier,
  AgentActionType,
  DiscoveredAgentTool,
} from "./types";

function tierForCapabilityOnly(): AgentActionTier {
  return "capability-detected";
}

function tierForCheckFinding(
  finding: AgentActionCheckFinding,
  hasUserInput: boolean,
  hasValidation: boolean
): AgentActionTier {
  if (finding.action === "BLOCK" && hasUserInput && !hasValidation) {
    return "likely-exploitable";
  }
  if (finding.action === "BLOCK" || finding.severity === "CRITICAL") {
    return "potentially-dangerous";
  }
  if (hasUserInput && !hasValidation) {
    return "insufficient-restrictions";
  }
  return "potentially-dangerous";
}

function confidenceForTier(tier: AgentActionTier, base: "HIGH" | "MEDIUM" | "LOW"): "HIGH" | "MEDIUM" | "LOW" {
  if (tier === "capability-detected") return "LOW";
  if (tier === "insufficient-restrictions") return base === "HIGH" ? "MEDIUM" : "LOW";
  return base;
}

function scanTool(
  path: string,
  tool: DiscoveredAgentTool
): AgentActionRawFinding[] {
  const findings: AgentActionRawFinding[] = [];
  const actionTypes = new Set<AgentActionType>();
  const nameType = inferActionTypeFromToolName(tool.name);
  if (nameType) actionTypes.add(nameType);
  for (const type of inferActionTypesFromHandler(tool.block)) {
    actionTypes.add(type);
  }

  const hasUserInput = handlerUsesUserInput(tool.block);
  const hasValidation = handlerHasValidation(tool.block);

  for (const actionType of actionTypes) {
    if (nameType === actionType && !extractActionValues(tool.block, actionType).length) {
      findings.push({
        rule: `agent.capability.${actionType}`,
        severity: "MEDIUM",
        action: "WARN",
        message: `Agent tool "${tool.name}" exposes ${actionType.replace(/_/g, " ")} capability to the model.`,
        category: categoryForActionType(actionType),
        file: path,
        line: tool.line,
        match: tool.name,
        confidence: "LOW",
        tier: tierForCapabilityOnly(),
        actionType,
        toolName: tool.name,
      });
    }

    for (const actionValue of extractActionValues(tool.block, actionType)) {
      for (const check of checkAgentAction(actionType, actionValue)) {
        const tier = tierForCheckFinding(check, hasUserInput, hasValidation);
        const baseConfidence = severityToConfidence(check.severity);
        findings.push({
          rule: check.rule,
          severity: check.severity,
          action: check.action,
          message: `${check.message} (agent tool "${tool.name}")`,
          category: categoryForActionType(actionType),
          file: path,
          line: tool.line,
          match: actionValue.slice(0, 100),
          confidence: confidenceForTier(tier, baseConfidence),
          tier,
          actionType,
          toolName: tool.name,
        });
      }
    }

    if (
      (actionType === "bash" || actionType === "process_spawn" || actionType === "http_request") &&
      hasUserInput &&
      !hasValidation
    ) {
      findings.push({
        rule: "agent.action.unvalidated-user-input",
        severity: "HIGH",
        action: "WARN",
        message: `Agent tool "${tool.name}" appears to pass user-controlled input into a ${actionType.replace(/_/g, " ")} capability without visible validation.`,
        category: categoryForActionType(actionType),
        file: path,
        line: tool.line,
        match: tool.name,
        confidence: "MEDIUM",
        tier: "insufficient-restrictions",
        actionType,
        toolName: tool.name,
      });
    }
  }

  return findings;
}

export function scanAgentActionFile(path: string, content: string): AgentActionRawFinding[] {
  if (!AGENT_TOOL_DEFINITION_MARKERS.some((pattern) => pattern.test(content))) {
    if (!isAgentRelatedPath(path)) {
      return [];
    }
  }

  const tools = discoverAgentTools(path, content);
  if (tools.length === 0) return [];

  const findings: AgentActionRawFinding[] = [];
  for (const tool of tools) {
    findings.push(...scanTool(path, tool));
  }
  return dedupeAgentActionFindings(findings);
}

export function dedupeAgentActionFindings(findings: AgentActionRawFinding[]): AgentActionRawFinding[] {
  const seen = new Set<string>();
  const deduped: AgentActionRawFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.rule}|${finding.file}|${finding.line}|${finding.toolName ?? ""}|${finding.match ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}
