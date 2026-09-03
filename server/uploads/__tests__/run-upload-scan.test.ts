import { describe, expect, it, vi } from "vitest";
import { runUploadScan } from "../run-upload-scan";

const runMock = vi.fn();
const ensureVerdictMock = vi.fn().mockResolvedValue({ productionVerdictId: "verdict-1" });

vi.mock("@/server/security-scanner/scan-job-runner", () => ({
  InlineScanJobRunner: class {
    run(...args: unknown[]) {
      return runMock(...args);
    }
  },
}));

vi.mock("@/server/production-verdict/ensure-verdict-for-scan", () => ({
  ensureProductionVerdictForCompletedScan: (...args: unknown[]) => ensureVerdictMock(...args),
}));

/** A chainable query-builder stub: any .eq()/.in()/.select()/... call returns
 * itself, and the chain resolves (via then/await) to `result` whenever it's
 * awaited -- avoids hand-matching every exact call shape scan-job-store.ts
 * happens to use internally. */
function chainable(result: { data: unknown; error?: unknown }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(result);
      }
      if (prop === "single" || prop === "maybeSingle") {
        return async () => result;
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function adminStub(overrides?: { insertScanError?: boolean }) {
  const updates: Array<{ table: string; payload: unknown }> = [];
  return {
    updates,
    from: (table: string) => {
      if (table === "scans") {
        return {
          insert: (payload: Record<string, unknown>) => {
            updates.push({ table: "scans.insert", payload });
            return chainable(
              overrides?.insertScanError
                ? { data: null, error: { message: "boom" } }
                : { data: { id: "scan-1" }, error: null }
            );
          },
        };
      }
      if (table === "repository_scan_state") {
        return {
          upsert: (payload: unknown) => {
            updates.push({ table: "repository_scan_state.upsert", payload });
            return chainable({ data: null, error: null });
          },
        };
      }
      if (table === "scan_jobs") {
        return {
          insert: () => chainable({ data: { id: "job-1", status: "queued" }, error: null }),
          update: () => chainable({ data: { id: "job-1", status: "running" }, error: null }),
          select: () => chainable({ data: { id: "job-1", status: "running" }, error: null }),
        };
      }
      if (table === "scan_job_events") {
        return { insert: () => chainable({ data: null, error: null }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

const snapshot = {
  repositoryId: 0,
  owner: "",
  repo: "demo",
  isPrivate: true,
  defaultBranch: "upload",
  commitSha: "a".repeat(40),
  files: [],
  discoveredFiles: 0,
  totalBytes: 0,
  omissions: [],
};

describe("runUploadScan", () => {
  it("creates the scan row with source='upload' and calls the runner with the prefetched snapshot", async () => {
    runMock.mockResolvedValue(undefined);
    const admin = adminStub();

    const result = await runUploadScan(admin, {
      organizationId: "org-1",
      projectId: "proj-1",
      userId: "user-1",
      snapshot,
    });

    expect(result.scanId).toBe("scan-1");
    const scanInsert = admin.updates.find((u) => u.table === "scans.insert")!.payload as Record<
      string,
      unknown
    >;
    expect(scanInsert.source).toBe("upload");
    expect(scanInsert.trigger_type).toBe("manual");
    expect(ensureVerdictMock).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ organizationId: "org-1", projectId: "proj-1", scanId: "scan-1" })
    );
    expect(runMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scanId: "scan-1",
        repositoryId: "proj-1",
        organizationId: "org-1",
        prefetchedSnapshot: snapshot,
      })
    );
  });

  it("throws UploadScanError when the scan row cannot be created, without touching the runner", async () => {
    runMock.mockReset();
    const admin = adminStub({ insertScanError: true });

    await expect(
      runUploadScan(admin, { organizationId: "org-1", projectId: "proj-1", userId: "user-1", snapshot })
    ).rejects.toMatchObject({ code: "scan_creation_failed" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("propagates a runner failure instead of silently reporting success", async () => {
    runMock.mockReset();
    ensureVerdictMock.mockClear();
    runMock.mockRejectedValue(new Error("scanner exploded"));
    const admin = adminStub();

    await expect(
      runUploadScan(admin, { organizationId: "org-1", projectId: "proj-1", userId: "user-1", snapshot })
    ).rejects.toThrow("scanner exploded");
    expect(ensureVerdictMock).not.toHaveBeenCalled();
  });
});
