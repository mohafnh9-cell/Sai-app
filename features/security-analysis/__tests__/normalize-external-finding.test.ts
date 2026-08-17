import { describe, expect, it } from "vitest";
import {
  normalizeExternalFinding,
  normalizeExternalFindings,
} from "../normalize-external-finding";
import { deriveInitialVerificationStatus } from "../derive-verification-status";

describe("normalizeExternalFinding", () => {
  it("normalizes scan_security finding shape", () => {
    const result = normalizeExternalFinding(
      {
        line: 12,
        ruleId: "python.injection.sql-injection",
        severity: "error",
        confidence: "HIGH",
        message: "SQL injection detected",
      },
      "scan_security"
    );

    expect(result).not.toBeNull();
    expect(result!.externalRuleId).toBe("python.injection.sql-injection");
    expect(result!.severity).toBe("HIGH");
    expect(result!.severityRank).toBe(3);
    expect(result!.originalSeverity).toBe("error");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.sourceTool).toBe("scan_security");
    expect(result!.line).toBe(12);
    expect(result!.verificationStatus).toBe("POTENTIAL");
    expect(result!.ruleId).toBe(
      "agent-scanner.scan_security.python.injection.sql-injection"
    );
  });

  it("normalizes scan_agent_prompt finding with BLOCK action", () => {
    const result = normalizeExternalFinding(
      {
        rule_id: "generic.prompt.exfiltration.env-access",
        severity: "ERROR",
        message: "Prompt requests access to env vars",
        matched_text: "read the .env",
        risk_score: "90",
        action: "BLOCK",
        category: "exfiltration",
        confidence: "HIGH",
      },
      "scan_agent_prompt"
    );

    expect(result!.externalRuleId).toBe("generic.prompt.exfiltration.env-access");
    expect(result!.action).toBe("BLOCK");
    expect(result!.riskScore).toBe(90);
    expect(result!.category).toBe("exfiltration");
    expect(result!.verificationStatus).toBe("LIKELY");
    expect(result!.evidence).toBe("read the .env");
  });

  it("normalizes scan_mcp_server finding using id field", () => {
    const result = normalizeExternalFinding(
      {
        file: "server.js",
        severity: "ERROR",
        category: "permissions",
        id: "mcp.permissions.overly-broad",
        message: "Overly broad permissions detected",
        line: 10,
        confidence: "HIGH",
      },
      "scan_mcp_server"
    );

    expect(result!.externalRuleId).toBe("mcp.permissions.overly-broad");
    expect(result!.file).toBe("server.js");
    expect(result!.verificationStatus).toBe("POTENTIAL");
  });

  it("marks heuristic prompt findings as UNVERIFIED when not BLOCK/HIGH", () => {
    const result = normalizeExternalFinding(
      {
        rule_id: "skill.prompt.injection-override",
        severity: "WARNING",
        message: "Skill prompt contains injection",
        confidence: "MEDIUM",
      },
      "scan_skill"
    );

    expect(result!.verificationStatus).toBe("UNVERIFIED");
  });

  it("infers category from ruleId when missing", () => {
    const result = normalizeExternalFinding(
      {
        ruleId: "python.injection.sql-injection",
        severity: "error",
        message: "SQL injection",
      },
      "scan_security"
    );

    expect(result!.category).toBe("injection");
  });

  it("returns null for invalid input", () => {
    expect(normalizeExternalFinding(null, "scan_security")).toBeNull();
    expect(normalizeExternalFinding("bad", "scan_security")).toBeNull();
  });

  it("batch normalizes arrays and skips invalid entries", () => {
    const results = normalizeExternalFindings(
      [
        { ruleId: "a", severity: "error", message: "one" },
        null,
        { ruleId: "b", severity: "info", message: "two" },
      ],
      "scan_project"
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.sourceTool).toBe("scan_project");
  });
});

describe("deriveInitialVerificationStatus", () => {
  it("never returns CONFIRMED for raw scanner output", () => {
    const status = deriveInitialVerificationStatus({
      sourceTool: "scan_security",
      confidence: "HIGH",
      action: null,
    });
    expect(status).not.toBe("CONFIRMED");
  });
});
