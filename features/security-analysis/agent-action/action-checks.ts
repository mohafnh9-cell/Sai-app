import type { AgentActionCheckFinding, AgentActionType } from "./types";

type ActionRule = {
  rule: string;
  pattern: RegExp;
  severity: AgentActionCheckFinding["severity"];
  action: AgentActionCheckFinding["action"];
  message: string;
};

const BASH_RULES: ActionRule[] = [
  {
    rule: "bash.destructive.rm-rf",
    pattern:
      /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*r[a-zA-Z]*\s+-[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*rf[a-zA-Z]*|-[a-zA-Z]*fr[a-zA-Z]*)\s+[/~*]/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Destructive recursive force-delete targeting root, home, or wildcard path",
  },
  {
    rule: "bash.rce.curl-pipe-sh",
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|zsh|ksh|dash|python|perl|ruby)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Remote code execution: piping downloaded content directly into a shell interpreter",
  },
  {
    rule: "bash.sql.drop-table",
    pattern: /\bDROP\s+TABLE\b/i,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "SQL DROP TABLE detected - destructive database operation",
  },
  {
    rule: "bash.sql.delete-no-where",
    pattern: /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "SQL DELETE FROM without WHERE clause - will delete all rows",
  },
  {
    rule: "bash.disk.dd",
    pattern: /\bdd\s+if=/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Low-level disk write via dd - can destroy disk contents",
  },
  {
    rule: "bash.credential.ssh-key-read",
    pattern: /\bcat\s+~?\/?\.ssh\/id_(rsa|ed25519|ecdsa|dsa)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Attempting to read SSH private key",
  },
  {
    rule: "bash.credential.aws-creds",
    pattern: /\bcat\s+~?\/?\.aws\/credentials\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Attempting to read AWS credentials file",
  },
  {
    rule: "bash.permissions.chmod-777",
    pattern: /\bchmod\s+(777|666)\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Overly permissive file permissions (world-readable/writable)",
  },
  {
    rule: "bash.escalation.sudo",
    pattern: /\bsudo\b/,
    severity: "MEDIUM",
    action: "WARN",
    message: "Privilege escalation via sudo",
  },
  {
    rule: "bash.git.force-push",
    pattern: /\bgit\s+push\s+--force\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Git force push - can overwrite remote history and cause data loss",
  },
];

const CRON_RULES: ActionRule[] = [
  {
    rule: "cron.rce.curl-pipe",
    pattern: /\b(curl|wget)\b.*\|\s*(sh|bash|python|perl|ruby)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Cron entry downloads and executes remote code",
  },
  {
    rule: "cron.persistence.at-boot",
    pattern: /@reboot/,
    severity: "HIGH",
    action: "WARN",
    message: "Cron entry runs at reboot — potential persistence mechanism",
  },
];

const PROCESS_SPAWN_RULES: ActionRule[] = [
  {
    rule: "process_spawn.reverse-shell",
    pattern: /\b(nc|ncat|netcat)\s+.*-e\s+\/bin\/(sh|bash)\b/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Reverse shell via netcat",
  },
  {
    rule: "process_spawn.privilege-escalation",
    pattern: /\bsudo\b/,
    severity: "MEDIUM",
    action: "WARN",
    message: "Process spawned with elevated privileges via sudo",
  },
];

const GIT_RULES: ActionRule[] = [
  {
    rule: "git.destructive.force-push",
    pattern: /\bgit\s+push\s+.*--force\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Git force push — can overwrite remote history and cause data loss",
  },
  {
    rule: "git.destructive.reset-hard",
    pattern: /\bgit\s+reset\s+--hard\b/,
    severity: "HIGH",
    action: "WARN",
    message: "Git hard reset — discards all uncommitted changes",
  },
];

const DOCKER_RULES: ActionRule[] = [
  {
    rule: "docker.privileged",
    pattern: /--privileged/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Docker container with --privileged flag — full host access",
  },
  {
    rule: "docker.host-mount.root",
    pattern: /-v\s+\/:/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Docker container mounts host root filesystem",
  },
  {
    rule: "docker.host-mount.docker-sock",
    pattern: /-v\s+\/var\/run\/docker\.sock/,
    severity: "CRITICAL",
    action: "BLOCK",
    message: "Docker container mounts Docker socket — can control host Docker daemon",
  },
];

const SENSITIVE_FILE_PATTERNS = [
  { pattern: /(^|\/)\.env($|\.)/, label: ".env file", severity: "HIGH" as const },
  { pattern: /(^|\/)\.ssh\//, label: "SSH directory", severity: "CRITICAL" as const },
  { pattern: /credentials/i, label: "credentials file", severity: "HIGH" as const },
  { pattern: /secrets/i, label: "secrets file", severity: "HIGH" as const },
];

const SYSTEM_FILE_PATTERNS = [
  { pattern: /^\/etc\//, label: "/etc system config", severity: "CRITICAL" as const },
  { pattern: /^\/usr\//, label: "/usr system directory", severity: "CRITICAL" as const },
  { pattern: /^\/bin\//, label: "/bin system binaries", severity: "CRITICAL" as const },
];

const CREDENTIAL_READ_PATTERNS = [
  { pattern: /(^|\/)\.env($|\.)/, label: ".env file", severity: "MEDIUM" as const },
  { pattern: /\.pem$/, label: "PEM certificate/key", severity: "HIGH" as const },
  { pattern: /(^|\/)\.ssh\//, label: "SSH directory", severity: "HIGH" as const },
  { pattern: /secret/i, label: "secret file", severity: "HIGH" as const },
];

const PRIVATE_IP_PATTERNS = [
  { pattern: /\b127\.0\.0\.1\b/, label: "loopback address (127.0.0.1)" },
  { pattern: /\blocalhost\b/, label: "localhost" },
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, label: "private IP (10.x.x.x)" },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/, label: "private IP (192.168.x.x)" },
];

const EXFILTRATION_PATTERNS = [
  { pattern: /webhook\.site/i, label: "webhook.site" },
  { pattern: /ngrok\.io/i, label: "ngrok tunnel" },
  { pattern: /pipedream/i, label: "Pipedream" },
];

function runRules(value: string, rules: ActionRule[]): AgentActionCheckFinding[] {
  const findings: AgentActionCheckFinding[] = [];
  const normalized = value.toLowerCase();
  for (const rule of rules) {
    if (rule.pattern.test(value) || rule.pattern.test(normalized)) {
      findings.push({
        rule: rule.rule,
        severity: rule.severity,
        action: rule.action,
        message: rule.message,
      });
    }
  }
  return findings;
}

export function checkAgentAction(
  actionType: AgentActionType,
  actionValue: string
): AgentActionCheckFinding[] {
  switch (actionType) {
    case "bash":
      return runRules(actionValue, BASH_RULES);
    case "cron": {
      const findings = runRules(actionValue, CRON_RULES);
      const cmdPortion = actionValue.replace(/^[@*0-9,\-/\\s]+/, "").trim();
      return cmdPortion ? [...findings, ...runRules(cmdPortion, BASH_RULES)] : findings;
    }
    case "process_spawn":
      return [...runRules(actionValue, PROCESS_SPAWN_RULES), ...runRules(actionValue, BASH_RULES)];
    case "git":
      return runRules(actionValue, GIT_RULES);
    case "docker":
      return runRules(actionValue, DOCKER_RULES);
    case "file_write": {
      const findings: AgentActionCheckFinding[] = [];
      for (const pattern of SYSTEM_FILE_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_write.system.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "CRITICAL",
            action: "BLOCK",
            message: `Writing to system path (${pattern.label}) is blocked`,
          });
        }
      }
      for (const pattern of SENSITIVE_FILE_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_write.sensitive.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: pattern.severity,
            action: "WARN",
            message: `Writing to sensitive file (${pattern.label}) - review carefully`,
          });
        }
      }
      return findings;
    }
    case "file_read": {
      const findings: AgentActionCheckFinding[] = [];
      for (const pattern of CREDENTIAL_READ_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_read.credential.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: pattern.severity,
            action: "WARN",
            message: `Reading credential/sensitive file (${pattern.label}) - potential secret exposure`,
          });
        }
      }
      return findings;
    }
    case "file_delete": {
      const findings: AgentActionCheckFinding[] = [];
      for (const pattern of [...SYSTEM_FILE_PATTERNS, ...SENSITIVE_FILE_PATTERNS]) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `file_delete.sensitive.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "CRITICAL",
            action: "BLOCK",
            message: `Deleting sensitive file (${pattern.label}) is blocked`,
          });
        }
      }
      return findings;
    }
    case "http_request": {
      const findings: AgentActionCheckFinding[] = [];
      for (const pattern of PRIVATE_IP_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `http.ssrf.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "CRITICAL",
            action: "BLOCK",
            message: `SSRF risk: request targets internal/private address (${pattern.label})`,
          });
        }
      }
      for (const pattern of EXFILTRATION_PATTERNS) {
        if (pattern.pattern.test(actionValue)) {
          findings.push({
            rule: `http.exfiltration.${pattern.label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
            severity: "HIGH",
            action: "WARN",
            message: `Potential data exfiltration: request targets known exfiltration service (${pattern.label})`,
          });
        }
      }
      return findings;
    }
    default:
      return [];
  }
}

export function severityToConfidence(
  severity: AgentActionCheckFinding["severity"]
): "HIGH" | "MEDIUM" | "LOW" {
  switch (severity) {
    case "CRITICAL":
      return "HIGH";
    case "HIGH":
      return "HIGH";
    case "MEDIUM":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

export function mapSeverityToExternal(severity: AgentActionCheckFinding["severity"]) {
  switch (severity) {
    case "CRITICAL":
      return "CRITICAL" as const;
    case "HIGH":
      return "HIGH" as const;
    case "MEDIUM":
      return "MEDIUM" as const;
    default:
      return "LOW" as const;
  }
}
