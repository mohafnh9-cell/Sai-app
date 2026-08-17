import type { McpSecurityRule } from "./types";

export const MCP_SECURITY_RULES: McpSecurityRule[] = [
  {
    id: "mcp.shell-exec-no-validation",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message:
      "Shell command execution without input validation. User-controlled input may reach exec/execSync, enabling arbitrary command execution.",
    pattern:
      /\b(exec|execSync)\s*\(\s*(`[^`]*\$\{|['"][^'"]*['"]\s*\+|[a-zA-Z_$][\w$]*(\s*\+|\s*,\s*\{[^}]*shell\s*:\s*true))/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.shell-exec-direct",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message:
      "Direct use of exec/execSync with potential string concatenation. Prefer execFile/execFileSync with explicit argument arrays and shell:false.",
    pattern: /\bchild_process\b.*\b(exec|execSync)\b|\b(exec|execSync)\s*\(/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.spawn-shell-true",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message:
      "spawn/spawnSync called with shell:true, allowing shell injection. Use shell:false and pass arguments as an array.",
    pattern: /\b(spawn|spawnSync)\s*\([^)]*\{[^}]*shell\s*:\s*true/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.subprocess-shell",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message:
      "subprocess called with shell=True, allowing shell injection. Use shell=False with a command list.",
    pattern: /subprocess\.(run|call|Popen|check_output|check_call)\s*\([^)]*shell\s*=\s*True/g,
    fileTypes: [".py"],
  },
  {
    id: "mcp.os-system",
    severity: "ERROR",
    category: "overly-broad-permissions",
    message: "os.system() executes commands through the shell. Use subprocess with shell=False instead.",
    pattern: /\bos\.system\s*\(/g,
    fileTypes: [".py"],
  },
  {
    id: "mcp.fs-write-no-path-validation",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message:
      "Filesystem write operation without visible path validation. Ensure paths are validated with path.resolve and confined to an allowed directory.",
    pattern:
      /\b(writeFileSync|writeFile|createWriteStream|appendFileSync|appendFile)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.resolve|path\.join|path\.normalize))/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.http-request-user-url",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message:
      "HTTP request to a potentially user-controlled URL. Validate and allowlist target URLs to prevent SSRF.",
    pattern:
      /\b(fetch|axios\.(get|post|put|delete|request)|http\.request|https\.request|got|request)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*['"`])/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.env-var-exposure",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message:
      "Environment variables accessed and potentially exposed in tool output. Ensure secrets are not leaked through MCP responses.",
    pattern: /process\.env\b/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.env-var-exposure-python",
    severity: "WARNING",
    category: "overly-broad-permissions",
    message:
      "Environment variables accessed and potentially exposed in tool output. Ensure secrets are not leaked through MCP responses.",
    pattern: /os\.environ\b|os\.getenv\s*\(/g,
    fileTypes: [".py"],
  },
  {
    id: "mcp.no-input-validation",
    severity: "WARNING",
    category: "missing-input-validation",
    message:
      "Tool handler accepts string input without visible validation or sanitization. Use zod, joi, or manual validation to constrain inputs.",
    pattern: /\.tool\s*\(\s*["'][^"']+["']\s*,\s*["'][^"']*["']\s*,\s*\{[^}]*\}\s*,\s*(async\s+)?\(\s*\{/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines, lineIndex) => {
      const lookahead = lines.slice(lineIndex, lineIndex + 15).join("\n");
      const hasValidation =
        /\b(z\.|zod\.|joi\.|validate|sanitize|schema|\.parse\(|\.safeParse\(|isValid|assert|check)\b/i.test(
          lookahead
        );
      return !hasValidation;
    },
  },
  {
    id: "mcp.path-no-normalize",
    severity: "WARNING",
    category: "missing-input-validation",
    message:
      "File path used without normalization. Use path.resolve() or path.normalize() to prevent path traversal attacks.",
    pattern:
      /\b(readFileSync|readFile|existsSync|statSync|stat|unlink|unlinkSync|rmdir|rmdirSync|mkdir|mkdirSync)\s*\(\s*[a-zA-Z_$][\w$.]*(?!\s*(?:path\.|resolve|normalize))/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines, lineIndex) => {
      const context = lines.slice(Math.max(0, lineIndex - 5), lineIndex + 1).join("\n");
      return !/path\.(resolve|normalize|join)\s*\(/.test(context);
    },
  },
  {
    id: "mcp.url-no-validation",
    severity: "WARNING",
    category: "missing-input-validation",
    message:
      "URL used without validation. Validate URL scheme and host to prevent SSRF and open redirect vulnerabilities.",
    pattern: /new\s+URL\s*\(\s*[a-zA-Z_$][\w$.]*\s*\)|url\.parse\s*\(\s*[a-zA-Z_$][\w$.]*\s*\)/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines, lineIndex) => {
      const lookahead = lines.slice(lineIndex, lineIndex + 5).join("\n");
      return !/\.(hostname|host|protocol|origin)\s*(===|!==|==|!=)|allowlist|whitelist|allowed/i.test(
        lookahead
      );
    },
  },
  {
    id: "mcp.exfiltration-external-request",
    severity: "ERROR",
    category: "data-exfiltration",
    message:
      "Data sent to an external URL. MCP servers should not exfiltrate data to third-party endpoints without explicit user consent.",
    pattern:
      /\b(fetch|axios\.(post|put|patch)|http\.request|https\.request)\s*\(\s*['"`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"` ]+)['"`]/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.exfiltration-external-request-python",
    severity: "ERROR",
    category: "data-exfiltration",
    message:
      "Data sent to an external URL. MCP servers should not exfiltrate data to third-party endpoints without explicit user consent.",
    pattern:
      /\b(requests\.(post|put|patch)|urllib\.request\.urlopen|httpx\.(post|put|patch))\s*\(\s*['"`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"` ]+)['"`]/g,
    fileTypes: [".py"],
  },
  {
    id: "mcp.exfiltration-network-socket",
    severity: "WARNING",
    category: "data-exfiltration",
    message:
      "Network socket created. Verify this is not used to exfiltrate data to external hosts.",
    pattern: /\bnet\.(createConnection|connect|Socket)\s*\(|new\s+WebSocket\s*\(/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.exfiltration-log-secrets",
    severity: "WARNING",
    category: "data-exfiltration",
    message:
      "Potentially sensitive data (keys, tokens, passwords) logged or printed. This may leak secrets through MCP server stderr.",
    pattern:
      /\b(console\.(log|error|warn|info)|print|logging\.(info|warning|error|debug))\s*\([^)]*\b(key|token|password|secret|credential|api_key|apiKey|auth|bearer)\b/gi,
    fileTypes: [".js", ".ts", ".py"],
  },
  {
    id: "mcp.eval-usage",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "eval() executes arbitrary code. Never use eval with user-controlled input in an MCP server.",
    pattern: /\beval\s*\(/g,
    fileTypes: [".js", ".ts", ".py"],
  },
  {
    id: "mcp.function-constructor",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "new Function() is equivalent to eval(). Avoid constructing functions from strings.",
    pattern: /new\s+Function\s*\(/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.exec-string-concat",
    severity: "ERROR",
    category: "insecure-patterns",
    message:
      "child_process.exec() with string concatenation is vulnerable to command injection. Use execFile() with argument arrays.",
    pattern: /\bexec\s*\(\s*['"`][^'"`]*['"`]\s*\+/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.cors-wildcard",
    severity: "WARNING",
    category: "insecure-patterns",
    message:
      "CORS configured with wildcard origin (*). This allows any website to interact with the MCP server.",
    pattern: /cors\s*\(\s*\{[^}]*origin\s*:\s*['"]\*['"]/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.cors-permissive",
    severity: "INFO",
    category: "insecure-patterns",
    message: "CORS enabled. Verify the origin configuration is appropriately restrictive.",
    pattern: /\bcors\s*\(\s*\)/g,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.no-auth-check",
    severity: "INFO",
    category: "insecure-patterns",
    message:
      "No authentication or authorization checks detected. If this MCP server is network-accessible, add authentication.",
    pattern: /\b(createServer|listen)\s*\(/g,
    fileTypes: [".js", ".ts"],
    contextCheck: (_line, lines) => {
      const fullSource = lines.join("\n");
      return !/\b(auth|authenticate|authorize|jwt|bearer|token|apiKey|api_key|session|passport)\b/i.test(
        fullSource
      );
    },
  },
  {
    id: "mcp.pickle-load",
    severity: "ERROR",
    category: "insecure-patterns",
    message:
      "pickle.load/loads deserializes arbitrary Python objects. This can execute arbitrary code if the input is attacker-controlled.",
    pattern: /\bpickle\.(load|loads)\s*\(/g,
    fileTypes: [".py"],
  },
  {
    id: "mcp.yaml-unsafe-load",
    severity: "ERROR",
    category: "insecure-patterns",
    message: "yaml.load() without SafeLoader can execute arbitrary Python. Use yaml.safe_load() instead.",
    pattern: /\byaml\.load\s*\([^)]*(?!Loader\s*=\s*yaml\.SafeLoader)/g,
    fileTypes: [".py"],
  },
  {
    id: "mcp.unicode-zero-width",
    severity: "ERROR",
    category: "unicode-poisoning",
    message:
      "Zero-width or invisible Unicode character detected in source. This is a common technique to hide injected instructions in tool descriptions.",
    pattern: /[\u200B\u200C\u200D\uFEFF\u2060]/g,
    fileTypes: [".js", ".ts", ".py"],
  },
  {
    id: "mcp.unicode-bidi-override",
    severity: "ERROR",
    category: "unicode-poisoning",
    message:
      "Bidirectional text override character detected. Attackers use these to make malicious code appear differently in editors vs. execution.",
    pattern: /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g,
    fileTypes: [".js", ".ts", ".py"],
  },
  {
    id: "mcp.unicode-homoglyph",
    severity: "WARNING",
    category: "unicode-poisoning",
    message:
      "Cyrillic character found adjacent to ASCII characters. This is a common homoglyph substitution pattern used in tool name spoofing attacks.",
    pattern: /[a-zA-Z][\u0400-\u04FF]|[\u0400-\u04FF][a-zA-Z]/g,
    fileTypes: [".js", ".ts", ".py"],
  },
  {
    id: "mcp.description-injection",
    severity: "ERROR",
    category: "description-injection",
    message:
      "Tool description contains imperative language directed at the LLM. This pattern is used in tool poisoning attacks to inject hidden instructions.",
    pattern:
      /server\.tool\s*\(\s*["'`][^"'`]*["'`]\s*,\s*["'`][^"'`]*(ignore\s+previous|exfiltrat|override\s+.*instruction|do\s+not\s+tell|hidden\s+instruction|bypass\s+.*filter|disregard\s+|extract\s+.*credential)[^"'`]*["'`]/gi,
    fileTypes: [".js", ".ts"],
  },
  {
    id: "mcp.tool-name-spoofing",
    severity: "ERROR",
    category: "tool-name-spoofing",
    message:
      "Tool name is suspiciously similar to a well-known MCP tool. This may be a name spoofing attack.",
    pattern: /server\.tool\s*\(\s*["'`]([a-zA-Z_$][\w$]*)["'`]/g,
    fileTypes: [".js", ".ts"],
    isSpoofingRule: true,
  },
];

export const MCP_CATEGORY_REMEDIATION: Record<string, string> = {
  "overly-broad-permissions":
    "Replace shell execution with argument-array APIs, validate file paths, and avoid exposing environment variables in MCP tool responses.",
  "missing-input-validation":
    "Add schema validation for all MCP tool inputs using zod or equivalent validators.",
  "data-exfiltration":
    "Audit outbound network calls and remove logging of secrets from MCP server output.",
  "insecure-patterns":
    "Remove eval/Function usage, tighten CORS, and add authentication for network-accessible MCP servers.",
  "unicode-poisoning":
    "Remove hidden Unicode characters from tool names and descriptions.",
  "description-injection":
    "Rewrite tool descriptions to describe functionality only — remove LLM-directed instructions.",
  "tool-name-spoofing":
    "Verify tool names are intentional and do not mimic well-known MCP tools.",
  "schema-manipulation":
    "Inspect inputSchema metadata for hidden instructions, suspicious defaults, or open additionalProperties.",
  "cross-tool-manipulation":
    "Remove cross-tool priority directives from tool descriptions.",
  "rug-pull":
    "Compare MCP tool definitions against a trusted baseline before approving changes.",
  manifest: "Fix malformed MCP manifest JSON before deploying the server.",
};
