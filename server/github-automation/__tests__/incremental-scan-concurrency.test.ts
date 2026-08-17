import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ACTIVE_AUTOMATION_SCAN_STATUSES,
  createAutomationScan,
  findActiveIncrementalScanId,
} from "../automation-scan";

type ScanRow = {
  id: string;
  organization_id: string;
  project_id: string;
  repository_id: string;
  triggered_by_user_id: string;
  trigger_type: string;
  scan_type: "incremental" | "full";
  status: string;
  branch: string | null;
  commit_sha: string | null;
};

function violatesActiveIncrementalUnique(rows: ScanRow[], candidate: ScanRow): boolean {
  return rows.some(
    (row) =>
      row.repository_id === candidate.repository_id &&
      row.commit_sha === candidate.commit_sha &&
      row.scan_type === "incremental" &&
      candidate.scan_type === "incremental" &&
      row.commit_sha != null &&
      ACTIVE_AUTOMATION_SCAN_STATUSES.includes(
        row.status as (typeof ACTIVE_AUTOMATION_SCAN_STATUSES)[number]
      ) &&
      ACTIVE_AUTOMATION_SCAN_STATUSES.includes(
        candidate.status as (typeof ACTIVE_AUTOMATION_SCAN_STATUSES)[number]
      )
  );
}

function createScanStore() {
  const scans: ScanRow[] = [];
  const scanState: Array<{ repository_id: string; organization_id: string; active_scan_id: string }> =
    [];
  let nextId = 1;

  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let operation: "select" | "insert" | "upsert" = "select";
      let pendingInsert: Partial<ScanRow> | null = null;
      let pendingUpsert: Record<string, unknown> | null = null;
      let limitCount: number | null = null;
      let inValues: string[] | null = null;

      const builder = {
        select() {
          return builder;
        },
        insert(values: Partial<ScanRow>) {
          operation = "insert";
          pendingInsert = values;
          return builder;
        },
        upsert(values: Record<string, unknown>) {
          operation = "upsert";
          pendingUpsert = values;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        in(column: string, values: string[]) {
          if (column === "status") {
            inValues = values;
          }
          return builder;
        },
        limit(count: number) {
          limitCount = count;
          return builder;
        },
        single: async () => {
          if (operation === "insert" && pendingInsert) {
            const candidate = pendingInsert as ScanRow;
            if (violatesActiveIncrementalUnique(scans, candidate)) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate active incremental scan" },
              };
            }
            const row: ScanRow = {
              id: `scan-${nextId++}`,
              organization_id: candidate.organization_id,
              project_id: candidate.project_id,
              repository_id: candidate.repository_id,
              triggered_by_user_id: candidate.triggered_by_user_id,
              trigger_type: candidate.trigger_type ?? "webhook",
              scan_type: candidate.scan_type,
              status: candidate.status ?? "queued",
              branch: candidate.branch ?? null,
              commit_sha: candidate.commit_sha ?? null,
            };
            scans.push(row);
            return { data: { id: row.id }, error: null };
          }
          throw new Error("single() called without insert");
        },
        maybeSingle: async () => {
          if (operation === "upsert" && pendingUpsert) {
            scanState.push({
              repository_id: pendingUpsert.repository_id as string,
              organization_id: pendingUpsert.organization_id as string,
              active_scan_id: pendingUpsert.active_scan_id as string,
            });
            return { data: pendingUpsert, error: null };
          }

          const matched = scans.filter((row) => {
            if (filters.repository_id != null && row.repository_id !== filters.repository_id) {
              return false;
            }
            if (filters.commit_sha != null && row.commit_sha !== filters.commit_sha) {
              return false;
            }
            if (filters.scan_type != null && row.scan_type !== filters.scan_type) {
              return false;
            }
            if (filters.id != null && row.id !== filters.id) {
              return false;
            }
            if (inValues && !inValues.includes(row.status)) {
              return false;
            }
            return true;
          });

          const row = limitCount != null ? matched[0] : matched[0];
          return { data: row ?? null, error: null };
        },
      };

      return builder;
    },
  };

  return { admin: admin as unknown as SupabaseClient, scans };
}

describe("createAutomationScan incremental concurrency", () => {
  const baseInput = {
    organizationId: "org-a",
    projectId: "repo-a",
    userId: "user-a",
    scanType: "incremental" as const,
    branch: "feature/test",
    commitSha: "abc123",
  };

  it("creates the first incremental scan successfully", async () => {
    const { admin, scans } = createScanStore();
    const scanId = await createAutomationScan(admin, baseInput);
    expect(scanId).toBeTruthy();
    expect(scans).toHaveLength(1);
  });

  it("reuses the active scan for duplicate repository + SHA", async () => {
    const { admin } = createScanStore();
    const first = await createAutomationScan(admin, baseInput);
    const second = await createAutomationScan(admin, baseInput);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("allows only one active owner under concurrent creation attempts", async () => {
    const { admin, scans } = createScanStore();
    const results = await Promise.all([
      createAutomationScan(admin, baseInput),
      createAutomationScan(admin, baseInput),
    ]);
    expect(results.filter(Boolean)).toHaveLength(2);
    expect(new Set(results.filter(Boolean)).size).toBe(1);
    expect(scans.filter((scan) => scan.status === "queued")).toHaveLength(1);
  });

  it("creates a new scan for a different SHA", async () => {
    const { admin, scans } = createScanStore();
    const first = await createAutomationScan(admin, baseInput);
    const second = await createAutomationScan(admin, {
      ...baseInput,
      commitSha: "def456",
    });
    expect(first).not.toBe(second);
    expect(scans).toHaveLength(2);
  });

  it("creates independent scans for different repositories with the same SHA", async () => {
    const { admin, scans } = createScanStore();
    const first = await createAutomationScan(admin, baseInput);
    const second = await createAutomationScan(admin, {
      ...baseInput,
      projectId: "repo-b",
    });
    expect(first).not.toBe(second);
    expect(scans).toHaveLength(2);
  });

  it("does not block a new scan when the historical scan is completed", async () => {
    const { admin, scans } = createScanStore();
    const completedId = await createAutomationScan(admin, baseInput);
    scans[0]!.status = "completed";

    const nextId = await createAutomationScan(admin, baseInput);
    expect(nextId).toBeTruthy();
    expect(nextId).not.toBe(completedId);
    expect(scans).toHaveLength(2);
  });

  it("does not block a new scan when the historical scan failed", async () => {
    const { admin, scans } = createScanStore();
    const failedId = await createAutomationScan(admin, baseInput);
    scans[0]!.status = "failed";

    const nextId = await createAutomationScan(admin, baseInput);
    expect(nextId).toBeTruthy();
    expect(nextId).not.toBe(failedId);
    expect(scans).toHaveLength(2);
  });

  it("allows incremental scans while a full scan is active on another commit", async () => {
    const { admin, scans } = createScanStore();
    scans.push({
      id: "scan-full",
      organization_id: baseInput.organizationId,
      project_id: baseInput.projectId,
      repository_id: baseInput.projectId,
      triggered_by_user_id: baseInput.userId,
      trigger_type: "webhook",
      scan_type: "full",
      status: "scanning",
      branch: "main",
      commit_sha: "full-sha",
    });

    const incrementalId = await createAutomationScan(admin, baseInput);
    expect(incrementalId).toBeTruthy();
    expect(scans.filter((scan) => scan.scan_type === "incremental")).toHaveLength(1);
  });

  it("findActiveIncrementalScanId returns the active scan", async () => {
    const { admin } = createScanStore();
    const created = await createAutomationScan(admin, baseInput);
    const found = await findActiveIncrementalScanId(admin, {
      repositoryId: baseInput.projectId,
      commitSha: baseInput.commitSha,
    });
    expect(found).toBe(created);
  });
});
