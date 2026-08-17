import type { AgentActionType } from "./types";

import { SCAN_SKIP_DIR_SEGMENTS } from "../shared/constants";

export const AGENT_ACTION_RULE_ID = "agent-action.security";
export const AGENT_ACTION_SOURCE_TOOL = "scan_agent_action" as const;

export const AGENT_ACTION_SKIP_DIRS = SCAN_SKIP_DIR_SEGMENTS;

export const AGENT_TOOL_DEFINITION_MARKERS = [
  /server\.tool\s*\(/,
  /\.registerTool\s*\(/,
  /defineTool\s*\(/,
  /createTool\s*\(/,
  /new\s+DynamicTool\s*\(/,
  /new\s+StructuredTool\s*\(/,
  /new\s+Tool\s*\(/,
  /ChatCompletionTool\s*\(/,
  /tool\s*\(\s*\{[\s\S]{0,120}?name\s*:/,
  /tools\s*:\s*\[[\s\S]{0,200}?type\s*:\s*["']function["']/,
] as const;

export const VALIDATION_INDICATORS =
  /\b(schema\.parse|safeParse|\.parse\s*\(|\.safeParse\s*\(|validate\s*\(|sanitize\s*\(|allowlist|allowList|whitelist|isAllowed|assertValid|checkCommand|if\s*\(\s*!.*includes|\.includes\s*\(|\.max\s*\(\s*\d+|\.min\s*\(\s*\d+)/i;

export const USER_INPUT_INDICATORS =
  /\b(args|input|params|toolInput|userInput|request|req|body|message|command|cmd|path|url|query)\b|\$\{(?:args|input|params|req|body|cmd|path|url)/i;

export const AGENT_ACTION_CATEGORY_REMEDIATION: Record<string, string> = {
  "agent-capability":
    "Review whether this agent tool capability is required in production and restrict it with allowlists and human approval.",
  "agent-shell":
    "Avoid granting agents arbitrary shell execution. Use fixed commands, argument arrays, and strict validation.",
  "agent-filesystem":
    "Confine agent file access to an explicit workspace directory and validate paths before read/write/delete.",
  "agent-network":
    "Allowlist outbound URLs for agent HTTP tools and block access to internal/private addresses.",
  "agent-git":
    "Prevent destructive git operations from agent tools unless explicitly approved and audited.",
  "agent-docker":
    "Do not expose privileged Docker operations to agents. Use isolated sandboxes with minimal mounts.",
  "agent-secrets":
    "Keep credentials out of agent-accessible paths and never expose environment secrets through agent tools.",
};

export const CAPABILITY_TOOL_NAME_PATTERNS: Record<AgentActionType, RegExp> = {
  bash: /^(bash|shell|run_?command|runCommand|terminal|execute_?command)$/i,
  file_write: /^(write_?file|writeFile|create_?file|save_?file|edit_?file)$/i,
  file_read: /^(read_?file|readFile|get_?file|load_?file)$/i,
  file_delete: /^(delete_?file|remove_?file|unlink|rm_?file)$/i,
  http_request: /^(http_?request|fetch|web_?request|curl|request_?url)$/i,
  cron: /^(cron|schedule|scheduled_?task)$/i,
  process_spawn: /^(spawn|process|run_?process|subprocess)$/i,
  git: /^(git|git_?command|git_?operation)$/i,
  docker: /^(docker|container|docker_?run)$/i,
};

export const HANDLER_CAPABILITY_PATTERNS: Array<{
  actionType: AgentActionType;
  pattern: RegExp;
  category: string;
}> = [
  { actionType: "bash", pattern: /\b(exec|execSync|spawn|spawnSync)\s*\(/, category: "agent-shell" },
  { actionType: "bash", pattern: /\bchild_process\b/, category: "agent-shell" },
  { actionType: "bash", pattern: /subprocess\.(run|call|Popen)/, category: "agent-shell" },
  { actionType: "bash", pattern: /\bos\.system\s*\(/, category: "agent-shell" },
  { actionType: "file_write", pattern: /\b(writeFile|writeFileSync|appendFile|createWriteStream)\s*\(/, category: "agent-filesystem" },
  { actionType: "file_read", pattern: /\b(readFile|readFileSync|createReadStream)\s*\(/, category: "agent-filesystem" },
  { actionType: "file_delete", pattern: /\b(unlink|unlinkSync|rmSync|rmdir|deleteFile)\s*\(/, category: "agent-filesystem" },
  { actionType: "http_request", pattern: /\b(fetch|axios\.|http\.request|https\.request|got\s*\()\s*\(/, category: "agent-network" },
  { actionType: "git", pattern: /\bgit\s+(push|reset|clean|remote|config)/, category: "agent-git" },
  { actionType: "docker", pattern: /\bdocker\s+(run|exec|build)\b/, category: "agent-docker" },
  { actionType: "process_spawn", pattern: /\b(spawn|spawnSync|Popen)\s*\(/, category: "agent-shell" },
  { actionType: "cron", pattern: /@reboot|cron\.schedule/, category: "agent-shell" },
];
