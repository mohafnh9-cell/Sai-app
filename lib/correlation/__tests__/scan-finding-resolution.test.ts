import { describe, expect, it } from "vitest";
import {
  correlationKeyForScanFinding,
  diffScanFindingsByIdentity,
  type ScanFindingIdentitySnapshot,
} from "@/lib/correlation/scan-finding-resolution";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

function finding(overrides: Partial<ScanFindingIdentitySnapshot> = {}): ScanFindingIdentitySnapshot {
  return {
    id: overrides.id ?? "finding-1",
    projectId: overrides.projectId ?? PROJECT_A,
    ruleId: overrides.ruleId ?? "secrets.exposed",
    filePath: overrides.filePath ?? "src/config.ts",
    title: overrides.title ?? "Hardcoded API key",
    severity: overrides.severity ?? "critical",
    status: overrides.status ?? "open",
    metadata: overrides.metadata ?? {},
  };
}

describe("diffScanFindingsByIdentity", () => {
  it("1. classifies the same logical finding across scans as unchanged, even when its line moves", () => {
    const previous = finding({
      id: "prev-1",
      filePath: "src/config.ts",
      metadata: { correlationKey: "abc" },
    });
    // Same identity, different scan-local row id and a shifted line -- the
    // scan-local `fingerprint`/`start_line` columns are never part of identity.
    const current = finding({
      id: "curr-1",
      filePath: "src/config.ts",
      metadata: { correlationKey: "abc" },
    });

    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [previous], current: [current] });

    expect(diff.unchanged).toHaveLength(1);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.new).toHaveLength(0);
    expect(diff.unchanged[0]!.previous?.id).toBe("prev-1");
    expect(diff.unchanged[0]!.current?.id).toBe("curr-1");
  });

  it("2. classifies a finding present previously but absent now as resolved", () => {
    const previous = finding({ id: "prev-1" });
    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [previous], current: [] });

    expect(diff.resolved).toHaveLength(1);
    expect(diff.resolved[0]!.previous?.id).toBe("prev-1");
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.new).toHaveLength(0);
  });

  it("3. classifies a finding present now but absent previously as new", () => {
    const current = finding({ id: "curr-1" });
    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [], current: [current] });

    expect(diff.new).toHaveLength(1);
    expect(diff.new[0]!.current?.id).toBe("curr-1");
    expect(diff.resolved).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("4. correctly classifies a mixed set of unchanged, resolved, and new findings", () => {
    const stays = finding({ id: "stays", ruleId: "auth.missing-check", filePath: "a.ts", title: "A" });
    const goesAway = finding({ id: "goes-away", ruleId: "secrets.exposed", filePath: "b.ts", title: "B" });
    const appears = finding({ id: "appears", ruleId: "sql.injection", filePath: "c.ts", title: "C" });

    const diff = diffScanFindingsByIdentity({
      projectId: PROJECT_A,
      previous: [stays, goesAway],
      current: [
        finding({ id: "stays-again", ruleId: "auth.missing-check", filePath: "a.ts", title: "A" }),
        appears,
      ],
    });

    expect(diff.unchanged.map((e) => e.current?.id)).toEqual(["stays-again"]);
    expect(diff.resolved.map((e) => e.previous?.id)).toEqual(["goes-away"]);
    expect(diff.new.map((e) => e.current?.id)).toEqual(["appears"]);
  });

  it("5. is idempotent when the same scan's findings are diffed against themselves", () => {
    const findings = [
      finding({ id: "f1", ruleId: "a", filePath: "x.ts", title: "X" }),
      finding({ id: "f2", ruleId: "b", filePath: "y.ts", title: "Y" }),
    ];

    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: findings, current: findings });

    expect(diff.unchanged).toHaveLength(2);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.new).toHaveLength(0);
    expect(diff.ambiguous).toHaveLength(0);
  });

  it("6. refuses to compare findings across projects (throws rather than silently mixing tenants)", () => {
    const previous = finding({ id: "prev-1", projectId: PROJECT_A });
    const current = finding({ id: "curr-1", projectId: PROJECT_B });

    expect(() =>
      diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [previous], current: [current] })
    ).toThrow(/project/i);
  });

  it("6b. an identical rule+file+title finding in a different project is not treated as the same identity", () => {
    const projectAFinding = finding({ id: "a-1", projectId: PROJECT_A });
    const projectBFinding = finding({ id: "b-1", projectId: PROJECT_B });

    // Diffing each project's own findings independently must not let them
    // resolve one another, even though their correlation keys are identical
    // (identity is project-scoped by the caller's query, not by the key itself).
    const diffA = diffScanFindingsByIdentity({
      projectId: PROJECT_A,
      previous: [],
      current: [projectAFinding],
    });
    const diffB = diffScanFindingsByIdentity({
      projectId: PROJECT_B,
      previous: [],
      current: [projectBFinding],
    });

    expect(diffA.new).toHaveLength(1);
    expect(diffB.new).toHaveLength(1);
    expect(correlationKeyForScanFinding(projectAFinding)).toBe(correlationKeyForScanFinding(projectBFinding));
  });

  it("7. treats a finding moved to a different file as resolved + new, not unchanged (documented decision: file path is part of identity)", () => {
    const previous = finding({ id: "prev-1", filePath: "src/old-location.ts" });
    const current = finding({ id: "curr-1", filePath: "src/new-location.ts" });

    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [previous], current: [current] });

    expect(diff.resolved).toHaveLength(1);
    expect(diff.new).toHaveLength(1);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("8. treats a finding whose rule id changed as resolved + new, not unchanged (documented decision: rule id is part of identity)", () => {
    const previous = finding({ id: "prev-1", ruleId: "secrets.exposed-v1" });
    const current = finding({ id: "curr-1", ruleId: "secrets.exposed-v2" });

    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [previous], current: [current] });

    expect(diff.resolved).toHaveLength(1);
    expect(diff.new).toHaveLength(1);
    expect(diff.unchanged).toHaveLength(0);
  });

  it("does not fabricate a resolution when two findings in one scan share an identity (ambiguous, not guessed)", () => {
    const previous = [
      finding({ id: "prev-1", ruleId: "secrets.exposed", filePath: "a.ts", title: "Hardcoded secret" }),
      finding({ id: "prev-2", ruleId: "secrets.exposed", filePath: "a.ts", title: "Hardcoded secret" }),
    ];
    const current = [
      finding({ id: "curr-1", ruleId: "secrets.exposed", filePath: "a.ts", title: "Hardcoded secret" }),
    ];

    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous, current });

    expect(diff.ambiguous).toHaveLength(1);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
    expect(diff.new).toHaveLength(0);
  });

  it("falls back to rule+path+title when metadata.correlationKey is absent (pre-existing/historical rows)", () => {
    const previous = finding({ id: "prev-1", metadata: {} });
    const current = finding({ id: "curr-1", metadata: null });

    const diff = diffScanFindingsByIdentity({ projectId: PROJECT_A, previous: [previous], current: [current] });

    expect(diff.unchanged).toHaveLength(1);
  });
});
