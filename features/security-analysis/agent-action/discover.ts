import {
  AGENT_TOOL_DEFINITION_MARKERS,
  CAPABILITY_TOOL_NAME_PATTERNS,
  HANDLER_CAPABILITY_PATTERNS,
  USER_INPUT_INDICATORS,
  VALIDATION_INDICATORS,
} from "./constants";
import type { AgentActionType, DiscoveredAgentTool } from "./types";

export function hasAgentToolDefinitions(content: string): boolean {
  return AGENT_TOOL_DEFINITION_MARKERS.some((pattern) => pattern.test(content));
}

export function discoverAgentTools(path: string, content: string): DiscoveredAgentTool[] {
  if (!hasAgentToolDefinitions(content)) return [];

  const tools: DiscoveredAgentTool[] = [];
  const lines = content.split("\n");

  const patterns: Array<{ regex: RegExp; framework: DiscoveredAgentTool["framework"] }> = [
    { regex: /server\.tool\s*\(\s*["']([^"']+)["']/g, framework: "mcp" },
    { regex: /\.registerTool\s*\(\s*["']([^"']+)["']/g, framework: "ai-sdk" },
    { regex: /defineTool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "ai-sdk" },
    { regex: /createTool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "ai-sdk" },
    { regex: /new\s+DynamicTool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "langchain" },
    { regex: /new\s+Tool\s*\(\s*\{[\s\S]{0,120}?name\s*:\s*["']([^"']+)["']/g, framework: "langchain" },
    { regex: /name\s*:\s*["']([^"']+)["'][\s\S]{0,120}?description\s*:/g, framework: "generic" },
  ];

  for (const { regex, framework } of patterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1]?.trim();
      if (!name) continue;
      const line = content.slice(0, match.index).split("\n").length;
      const block = extractToolBlock(content, match.index, lines.length);
      if (tools.some((tool) => tool.name === name && tool.line === line)) continue;
      tools.push({ name, line, block, framework });
    }
  }

  return tools;
}

function extractToolBlock(content: string, startIndex: number, totalLines: number): string {
  const fromLine = content.slice(0, startIndex).split("\n").length - 1;
  const lines = content.split("\n");
  const endLine = Math.min(fromLine + 40, totalLines);
  return lines.slice(fromLine, endLine).join("\n");
}

export function inferActionTypeFromToolName(toolName: string): AgentActionType | null {
  for (const [actionType, pattern] of Object.entries(CAPABILITY_TOOL_NAME_PATTERNS) as Array<
    [AgentActionType, RegExp]
  >) {
    if (pattern.test(toolName)) return actionType;
  }
  return null;
}

export function inferActionTypesFromHandler(block: string): AgentActionType[] {
  const types = new Set<AgentActionType>();
  for (const entry of HANDLER_CAPABILITY_PATTERNS) {
    if (entry.pattern.test(block)) {
      types.add(entry.actionType);
    }
  }
  return [...types];
}

export function handlerUsesUserInput(block: string): boolean {
  return USER_INPUT_INDICATORS.test(block);
}

export function handlerHasValidation(block: string): boolean {
  return VALIDATION_INDICATORS.test(block);
}

export function extractActionValues(block: string, actionType: AgentActionType): string[] {
  const values = new Set<string>();

  const stringPatterns = [
    /["']([^"']{3,200})["']/g,
    /`([^`]{3,200})`/g,
  ];

  for (const pattern of stringPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(block)) !== null) {
      const value = match[1]?.trim();
      if (!value || value.includes("${")) continue;
      if (isRelevantValue(actionType, value)) {
        values.add(value);
      }
    }
  }

  return [...values];
}

function isRelevantValue(actionType: AgentActionType, value: string): boolean {
  switch (actionType) {
    case "bash":
    case "process_spawn":
    case "cron":
    case "git":
    case "docker":
      return /\b(rm|curl|wget|git|docker|sudo|chmod|dd|DROP|DELETE|spawn|exec|nc)\b/i.test(value);
    case "file_write":
    case "file_read":
    case "file_delete":
      return /\/|\.env|\.ssh|\.pem|credentials|secret|package\.json/i.test(value);
    case "http_request":
      return /^https?:\/\//i.test(value) || /\blocalhost\b|\b127\.0\.0\.1\b/.test(value);
    default:
      return false;
  }
}

export function categoryForActionType(actionType: AgentActionType): string {
  switch (actionType) {
    case "bash":
    case "process_spawn":
    case "cron":
      return "agent-shell";
    case "file_write":
    case "file_read":
    case "file_delete":
      return "agent-filesystem";
    case "http_request":
      return "agent-network";
    case "git":
      return "agent-git";
    case "docker":
      return "agent-docker";
    default:
      return "agent-capability";
  }
}

export function isAgentRelatedPath(path: string): boolean {
  return /(?:^|\/)((mcp|agent|agents|tools)(\/|$))/i.test(path);
}
