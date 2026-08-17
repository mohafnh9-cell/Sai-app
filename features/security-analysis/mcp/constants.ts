export const MCP_SCANNABLE_EXTENSIONS = new Set([".js", ".ts", ".py"]);

export const MCP_SKIP_DIR_SEGMENTS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "venv",
  "env",
  ".venv",
  "coverage",
  ".next",
  ".nuxt",
]);

export const MCP_MANIFEST_FILENAME = "server.json";
export const MCP_BASELINE_FILENAME = ".mcp-security-baseline.json";

export const MCP_CONTENT_INDICATORS = [
  /@modelcontextprotocol/,
  /from\s+['"]@modelcontextprotocol/,
  /server\.tool\s*\(/,
  /\bMcpServer\b/,
  /\bcreateMcpServer\b/,
  /\.registerTool\s*\(/,
  /\bmcp\.server\b/i,
] as const;

export const MANIFEST_INJECTION_PHRASES =
  /ignore\s+previous|exfiltrat|override\s+.*instruction|do\s+not\s+tell|hidden\s+instruction|bypass\s+.*filter|disregard\s+|extract\s+.*credential/i;

export const MANIFEST_ZERO_WIDTH = /[\u200B\u200C\u200D\uFEFF\u2060]/;
export const MANIFEST_BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/;

export const SUSPICIOUS_DEFAULT =
  /\b(curl|wget|nc|bash|sh|powershell|cmd)\b.*[|>]|https?:\/\/[^\s'"]+|ignore\s+previous|exfiltrat|override\s+.*instruction|do\s+not\s+tell|hidden\s+instruction|bypass\s+.*filter/i;

export const URL_IN_DESCRIPTION = /https?:\/\/[^\s'"<>]+/gi;
export const SAFE_URL_DOMAINS = /^https?:\/\/(github\.com|npmjs\.com|pypi\.org|docs\.|api\.)/i;
export const TUNNELING_URL =
  /https?:\/\/[^\s'"]*\b(ngrok|serveo|localtunnel|localhost|127\.0\.0\.1|webhook\.site|requestbin|pipedream|interact\.sh|burp|oast)\b/i;

export const PRIORITY_PATTERNS =
  /\b(before\s+calling\s+any\s+other\s+tool|do\s+not\s+use\s+any\s+other\s+tool|replaces?\s+the\s+function\s+of|must\s+be\s+(called|used|run|invoked)\s+(first|before)|always\s+(call|use|run|invoke)\s+this\s+(first|before)|instead\s+of\s+(using|calling))\b/i;

export const MCP_SECURITY_RULE_ID = "mcp.security";
export const MCP_SECURITY_SOURCE_TOOL = "scan_mcp_server" as const;
