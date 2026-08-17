import { createHash } from "node:crypto";
import {
  MANIFEST_BIDI,
  MANIFEST_INJECTION_PHRASES,
  MANIFEST_ZERO_WIDTH,
  PRIORITY_PATTERNS,
  SAFE_URL_DOMAINS,
  SUSPICIOUS_DEFAULT,
  TUNNELING_URL,
  URL_IN_DESCRIPTION,
} from "./constants";
import { findSpoofedTool } from "./spoofing";
import type { McpRawFinding } from "./types";

type ManifestTool = {
  name?: string;
  description?: string;
  inputSchema?: {
    additionalProperties?: boolean;
    properties?: Record<
      string,
      {
        description?: string;
        default?: unknown;
        enum?: unknown[];
      }
    >;
  };
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hashTool(tool: ManifestTool): string {
  return createHash("sha256")
    .update(JSON.stringify({ name: tool.name, description: tool.description }))
    .digest("hex");
}

function checkSchemaManipulation(tool: ManifestTool, manifestPath: string): McpRawFinding[] {
  const findings: McpRawFinding[] = [];
  const name = tool.name ?? "";
  const schema = tool.inputSchema;
  if (!schema || typeof schema !== "object") return findings;

  const properties = schema.properties ?? {};
  if (schema.additionalProperties === true && Object.keys(properties).length === 0) {
    findings.push({
      rule: "mcp.schema-open-additionalProperties",
      severity: "WARNING",
      category: "schema-manipulation",
      message: `Tool "${name}" has additionalProperties:true with no defined properties — accepts arbitrary hidden parameters.`,
      file: manifestPath,
      line: 1,
      match: name,
    });
  }

  for (const [propName, propDef] of Object.entries(properties)) {
    if (!propDef || typeof propDef !== "object") continue;
    const desc = propDef.description ?? "";
    const defaultVal = propDef.default !== undefined ? String(propDef.default) : "";
    const enumValues = Array.isArray(propDef.enum) ? propDef.enum.map(String) : [];

    if (
      desc &&
      (MANIFEST_INJECTION_PHRASES.test(desc) ||
        MANIFEST_ZERO_WIDTH.test(desc) ||
        MANIFEST_BIDI.test(desc))
    ) {
      findings.push({
        rule: "mcp.schema-description-injection",
        severity: "ERROR",
        category: "schema-manipulation",
        message: `Tool "${name}" property "${propName}" description contains injection language or hidden characters.`,
        file: manifestPath,
        line: 1,
        match: desc.slice(0, 100),
      });
    }

    if (defaultVal && SUSPICIOUS_DEFAULT.test(defaultVal)) {
      findings.push({
        rule: "mcp.schema-suspicious-default",
        severity: "ERROR",
        category: "schema-manipulation",
        message: `Tool "${name}" property "${propName}" has a suspicious default value containing shell commands, URLs, or injection patterns.`,
        file: manifestPath,
        line: 1,
        match: defaultVal.slice(0, 100),
      });
    }

    for (const val of enumValues) {
      if (MANIFEST_INJECTION_PHRASES.test(val) || SUSPICIOUS_DEFAULT.test(val)) {
        findings.push({
          rule: "mcp.schema-suspicious-default",
          severity: "ERROR",
          category: "schema-manipulation",
          message: `Tool "${name}" property "${propName}" has a suspicious enum value.`,
          file: manifestPath,
          line: 1,
          match: val.slice(0, 100),
        });
        break;
      }
    }
  }

  return findings;
}

function checkCrossToolManipulation(tools: ManifestTool[], manifestPath: string): McpRawFinding[] {
  const findings: McpRawFinding[] = [];
  const toolNames = new Set(tools.map((tool) => (tool.name ?? "").toLowerCase()).filter(Boolean));

  for (const tool of tools) {
    const name = tool.name ?? "";
    const description = tool.description ?? "";
    if (!description) continue;

    for (const otherName of toolNames) {
      if (otherName === name.toLowerCase()) continue;
      const escaped = escapeRegex(otherName);
      const refPattern1 = new RegExp(
        `\\b(before\\s+using|always\\s+(call|use|run|invoke)|after\\s+calling|instead\\s+of)\\s+\\w*${escaped}\\b`,
        "i"
      );
      const refPattern2 = new RegExp(
        `\\b(call|use|invoke|run|execute|trigger)\\s+\\w*${escaped}\\b.*\\b(first|before|always)\\b`,
        "i"
      );
      if (refPattern1.test(description) || refPattern2.test(description)) {
        findings.push({
          rule: "mcp.cross-tool-reference",
          severity: "ERROR",
          category: "cross-tool-manipulation",
          message: `Tool "${name}" description contains action directive referencing tool "${otherName}". This may be a cross-tool manipulation attack.`,
          file: manifestPath,
          line: 1,
          match: description.slice(0, 100),
        });
        break;
      }
    }

    if (PRIORITY_PATTERNS.test(description)) {
      findings.push({
        rule: "mcp.cross-tool-priority-override",
        severity: "ERROR",
        category: "cross-tool-manipulation",
        message: `Tool "${name}" description demands execution priority or exclusivity over other tools.`,
        file: manifestPath,
        line: 1,
        match: description.slice(0, 100),
      });
    }
  }

  return findings;
}

export function scanMcpManifest(manifestPath: string, content: string): McpRawFinding[] {
  let manifest: { tools?: ManifestTool[] };
  try {
    manifest = JSON.parse(content) as { tools?: ManifestTool[] };
  } catch {
    return [
      {
        rule: "mcp.manifest-parse-error",
        severity: "WARNING",
        category: "manifest",
        message: "server.json is not valid JSON.",
        file: manifestPath,
        line: 1,
        match: "",
      },
    ];
  }

  const findings: McpRawFinding[] = [];
  const tools = manifest.tools ?? [];

  for (const tool of tools) {
    const name = tool.name ?? "";
    const description = tool.description ?? "";

    if (MANIFEST_ZERO_WIDTH.test(description) || MANIFEST_ZERO_WIDTH.test(name)) {
      findings.push({
        rule: "mcp.unicode-zero-width",
        severity: "ERROR",
        category: "unicode-poisoning",
        message: "Zero-width Unicode character in manifest tool name or description.",
        file: manifestPath,
        line: 1,
        match: name,
      });
    }
    if (MANIFEST_BIDI.test(description) || MANIFEST_BIDI.test(name)) {
      findings.push({
        rule: "mcp.unicode-bidi-override",
        severity: "ERROR",
        category: "unicode-poisoning",
        message: "Bidirectional override character in manifest tool name or description.",
        file: manifestPath,
        line: 1,
        match: name,
      });
    }
    if (MANIFEST_INJECTION_PHRASES.test(description)) {
      findings.push({
        rule: "mcp.manifest-description-injection",
        severity: "ERROR",
        category: "description-injection",
        message: `Tool "${name}" description contains injection language. Likely tool poisoning.`,
        file: manifestPath,
        line: 1,
        match: description.slice(0, 100),
      });
    }
    if (name) {
      const spoof = findSpoofedTool(name);
      if (spoof) {
        findings.push({
          rule: "mcp.manifest-name-spoofing",
          severity: "ERROR",
          category: "tool-name-spoofing",
          message: `Manifest tool name "${name}" is ${spoof.distance} edit(s) away from well-known tool "${spoof.spoofed}".`,
          file: manifestPath,
          line: 1,
          match: name,
        });
      }
    }
    if (description.length > 500) {
      findings.push({
        rule: "mcp.manifest-description-too-long",
        severity: "WARNING",
        category: "description-injection",
        message: `Tool "${name}" description is ${description.length} chars — unusually long descriptions often contain hidden instructions.`,
        file: manifestPath,
        line: 1,
        match: description.slice(0, 100),
      });
    }

    findings.push(...checkSchemaManipulation(tool, manifestPath));

    const urls = description.match(URL_IN_DESCRIPTION);
    if (urls) {
      for (const url of urls) {
        if (TUNNELING_URL.test(url)) {
          findings.push({
            rule: "mcp.description-tunneling-url",
            severity: "ERROR",
            category: "description-injection",
            message: `Tool "${name}" description contains a dev/tunneling URL.`,
            file: manifestPath,
            line: 1,
            match: url.slice(0, 100),
          });
        } else if (!SAFE_URL_DOMAINS.test(url)) {
          findings.push({
            rule: "mcp.description-suspicious-url",
            severity: "WARNING",
            category: "description-injection",
            message: `Tool "${name}" description contains an external URL that the LLM might follow.`,
            file: manifestPath,
            line: 1,
            match: url.slice(0, 100),
          });
        }
      }
    }
  }

  findings.push(...checkCrossToolManipulation(tools, manifestPath));

  if (tools.length >= 5) {
    const lengths = tools.map((tool) => (tool.description ?? "").length);
    const mean = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
    const stddev = Math.sqrt(
      lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length
    );
    if (stddev > 0) {
      for (const tool of tools) {
        const len = (tool.description ?? "").length;
        const zScore = (len - mean) / stddev;
        if (zScore > 2.5) {
          findings.push({
            rule: "mcp.description-length-anomaly",
            severity: "WARNING",
            category: "description-injection",
            message: `Tool "${tool.name}" description length (${len} chars) is a statistical outlier (z-score: ${zScore.toFixed(1)}).`,
            file: manifestPath,
            line: 1,
            match: (tool.description ?? "").slice(0, 100),
          });
        }
      }
    }
  }

  return findings;
}

export function checkMcpRugPull(
  manifestPath: string,
  manifestContent: string,
  baselineContent: string | null
): McpRawFinding[] {
  if (!baselineContent) return [];

  let baseline: { tools?: Record<string, string> };
  let manifest: { tools?: ManifestTool[] };
  try {
    baseline = JSON.parse(baselineContent) as { tools?: Record<string, string> };
    manifest = JSON.parse(manifestContent) as { tools?: ManifestTool[] };
  } catch {
    return [];
  }

  const current: Record<string, string> = {};
  for (const tool of manifest.tools ?? []) {
    if (tool.name) {
      current[tool.name] = hashTool(tool);
    }
  }

  const baselineHashes = baseline.tools ?? {};
  const findings: McpRawFinding[] = [];

  for (const [name, hash] of Object.entries(current)) {
    if (!baselineHashes[name]) {
      findings.push({
        rule: "mcp.rug-pull-detected",
        severity: "ERROR",
        category: "rug-pull",
        message: `New tool "${name}" appeared since baseline was recorded. Verify this addition is intentional.`,
        file: manifestPath,
        line: 1,
        match: name,
      });
    } else if (baselineHashes[name] !== hash) {
      findings.push({
        rule: "mcp.rug-pull-detected",
        severity: "ERROR",
        category: "rug-pull",
        message: `Tool "${name}" schema/description changed since baseline. Rug pull indicator — verify the change is intentional.`,
        file: manifestPath,
        line: 1,
        match: name,
      });
    }
  }

  for (const name of Object.keys(baselineHashes)) {
    if (!current[name]) {
      findings.push({
        rule: "mcp.rug-pull-detected",
        severity: "ERROR",
        category: "rug-pull",
        message: `Tool "${name}" was removed since baseline was recorded. Verify this removal is intentional.`,
        file: manifestPath,
        line: 1,
        match: name,
      });
    }
  }

  return findings;
}
