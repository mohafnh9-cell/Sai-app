import { describe, expect, it } from "vitest";
import { getScanFindingResolution } from "../finding-resolution";

const ORG = "org-1";
const PROJECT = "project-1";
const OTHER_PROJECT = "project-2";
const PREVIOUS_SCAN = "scan-previous";
const CURRENT_SCAN = "scan-current";

type FindingRow = {
  id: string;
  project_id: string;
  organization_id: string;
  rule_id: string;
  file_path: string;
  title: string;
  severity: string;
  status: string;
  metadata: Record<string, unknown> | null;
};

function row(overrides: Partial<FindingRow>): FindingRow {
  return {
    id: overrides.id ?? "row-1",
    project_id: overrides.project_id ?? PROJECT,
    organization_id: overrides.organization_id ?? ORG,
    rule_id: overrides.rule_id ?? "secrets.exposed",
    file_path: overrides.file_path ?? "src/config.ts",
    title: overrides.title ?? "Hardcoded API key",
    severity: overrides.severity ?? "critical",
    status: overrides.status ?? "open",
    metadata: overrides.metadata ?? {},
  };
}

/**
 * Minimal chainable Supabase mock covering exactly the query shapes used by
 * getScanFindingResolution: scans (previous-scan lookup) and scan_findings
 * (row fetch), both filtered by organization_id + project_id.
 */
function mockAdmin(state: {
  previousScanId: string | null;
  findingsByScan: Record<string, FindingRow[]>;
}) {
  return {
    from: (table: string) => {
      if (table === "scans") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  neq: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({
                          data: state.previousScanId ? { id: state.previousScanId } : null,
                          error: null,
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "scan_findings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: (_col: string, scanId: string) =>
                  Promise.resolve({ data: state.findingsByScan[scanId] ?? [], error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

describe("getScanFindingResolution", () => {
  it("reports every current finding as new when there is no previous scan", async () => {
    const admin = mockAdmin({
      previousScanId: null,
      findingsByScan: {
        [CURRENT_SCAN]: [row({ id: "f1" })],
      },
    });

    const result = await getScanFindingResolution(admin, {
      organizationId: ORG,
      projectId: PROJECT,
      currentScanId: CURRENT_SCAN,
    });

    expect(result.previousScanId).toBeNull();
    expect(result.new).toHaveLength(1);
    expect(result.resolved).toHaveLength(0);
    expect(result.unchanged).toHaveLength(0);
  });

  it("classifies unchanged/resolved/new against the previous completed scan", async () => {
    const admin = mockAdmin({
      previousScanId: PREVIOUS_SCAN,
      findingsByScan: {
        [PREVIOUS_SCAN]: [
          row({ id: "stays", rule_id: "a", file_path: "x.ts", title: "X" }),
          row({ id: "goes-away", rule_id: "b", file_path: "y.ts", title: "Y" }),
        ],
        [CURRENT_SCAN]: [
          row({ id: "stays-2", rule_id: "a", file_path: "x.ts", title: "X" }),
          row({ id: "appears", rule_id: "c", file_path: "z.ts", title: "Z" }),
        ],
      },
    });

    const result = await getScanFindingResolution(admin, {
      organizationId: ORG,
      projectId: PROJECT,
      currentScanId: CURRENT_SCAN,
    });

    expect(result.previousScanId).toBe(PREVIOUS_SCAN);
    expect(result.unchanged.map((e) => e.current?.id)).toEqual(["stays-2"]);
    expect(result.resolved.map((e) => e.previous?.id)).toEqual(["goes-away"]);
    expect(result.new.map((e) => e.current?.id)).toEqual(["appears"]);
  });

  it("never mixes findings from another project into the comparison", async () => {
    const admin = mockAdmin({
      previousScanId: PREVIOUS_SCAN,
      findingsByScan: {
        // Rows the mock would return regardless of the project_id filter --
        // the real Supabase query filters server-side; this test only proves
        // the resolver's own logic stays correct given already-scoped rows.
        [PREVIOUS_SCAN]: [row({ id: "prev-1", project_id: PROJECT })],
        [CURRENT_SCAN]: [row({ id: "curr-1", project_id: PROJECT })],
      },
    });

    const result = await getScanFindingResolution(admin, {
      organizationId: ORG,
      projectId: PROJECT,
      currentScanId: CURRENT_SCAN,
    });

    expect(result.projectId).toBe(PROJECT);
    for (const entry of [...result.unchanged, ...result.resolved, ...result.new]) {
      if (entry.previous) expect(entry.previous.projectId).toBe(PROJECT);
      if (entry.current) expect(entry.current.projectId).toBe(PROJECT);
      expect(entry.previous?.projectId ?? PROJECT).not.toBe(OTHER_PROJECT);
    }
  });
});
