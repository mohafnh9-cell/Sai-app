import { describe, expect, it } from "vitest";
import { normalizeExternalFinding } from "../normalize-external-finding";
import {
  securityAnalysisFindingToDraft,
  securityAnalysisFindingsToDrafts,
} from "../to-finding-draft";
import { externalFindingsToDrafts, mergeExternalFindingDrafts } from "../integrate-scan-findings";

describe("securityAnalysisFindingToDraft", () => {
  it("maps normalized finding into SequrAI FindingDraft with verification metadata", () => {
    const normalized = normalizeExternalFinding(
      {
        ruleId: "mcp.permissions.overly-broad",
        severity: "ERROR",
        message: "Overly broad permissions detected",
        file: "server.js",
        line: 10,
        confidence: "HIGH",
      },
      "scan_mcp_server"
    );

    const draft = securityAnalysisFindingToDraft(normalized!);

    expect(draft.ruleId).toBe("agent-scanner.scan_mcp_server.mcp.permissions.overly-broad");
    expect(draft.severity).toBe("high");
    expect(draft.confidence).toBe("high");
    expect(draft.location).toEqual({ path: "server.js", line: 10 });
    expect(draft.metadata?.securityAnalysis).toMatchObject({
      verificationStatus: "POTENTIAL",
      sourceTool: "scan_mcp_server",
    });
    expect(draft.metadata?.evidenceReport).toMatchObject({
      confirmationStatus: "potential_vulnerability",
      verificationStatus: "POTENTIAL",
    });
  });

  it("downgrades heuristic prompt injection confidence in draft", () => {
    const normalized = normalizeExternalFinding(
      {
        rule_id: "generic.prompt.injection",
        severity: "WARNING",
        confidence: "HIGH",
        message: "Possible prompt injection pattern",
      },
      "scan_agent_prompt"
    );

    const draft = securityAnalysisFindingToDraft(normalized!);
    expect(draft.confidence).toBe("medium");
    expect(draft.metadata?.securityAnalysis).toMatchObject({
      verificationStatus: "UNVERIFIED",
    });
  });
});

describe("integrate-scan-findings", () => {
  it("converts raw findings to drafts for the scan pipeline", () => {
    const drafts = externalFindingsToDrafts(
      [{ ruleId: "python.crypto.weak-hash", severity: "warning", message: "Weak hash" }],
      "scan_security"
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.category).toBe("crypto");
  });

  it("merges external drafts without duplicates", () => {
    const existing = securityAnalysisFindingsToDrafts([
      normalizeExternalFinding(
        { ruleId: "a", severity: "error", message: "dup" },
        "scan_security"
      )!,
    ]);
    const external = externalFindingsToDrafts(
      [
        { ruleId: "a", severity: "error", message: "dup" },
        { ruleId: "b", severity: "info", message: "new" },
      ],
      "scan_security"
    );
    const merged = mergeExternalFindingDrafts(existing, external);
    expect(merged).toHaveLength(2);
  });
});
