import { describe, expect, it } from "vitest";
import type { ParsedPushDetection } from "@/brain/repository-sync";
import { recordPushDetection } from "../persistence";

/**
 * Minimal fake of the `repository_sync_status` table surface used by
 * `recordPushDetection`: select().eq().maybeSingle() to read the existing
 * row, and upsert() to write it.
 */
function createFakeAdmin() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    admin: {
      from(table: string) {
        if (table !== "repository_sync_status") {
          throw new Error(`Unexpected table in this fake: ${table}`);
        }
        let eqValue: unknown;
        return {
          select() {
            return this;
          },
          eq(_col: string, value: unknown) {
            eqValue = value;
            return this;
          },
          async maybeSingle() {
            return { data: rows.get(String(eqValue)) ?? null, error: null };
          },
          async upsert(row: Record<string, unknown>) {
            rows.set(String(row.project_id), row);
            return { error: null };
          },
        };
      },
    },
    rows,
  };
}

const PROJECT_1 = "11111111-1111-4111-8111-111111111111";

function detection(overrides: Partial<ParsedPushDetection> = {}): ParsedPushDetection {
  return {
    branch: "main",
    commitSha: "aaa1111",
    commitMessage: "message",
    pushedAt: "2026-02-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("recordPushDetection", () => {
  it("persists a fresh push detection immediately, independent of any scan", async () => {
    const { admin, rows } = createFakeAdmin();
    await recordPushDetection(admin as never, {
      organizationId: "org-1",
      projectId: PROJECT_1,
      githubRepositoryId: 123,
      detection: detection({ commitSha: "aaa1111" }),
    });

    const row = rows.get(PROJECT_1);
    expect(row?.commit_sha).toBe("aaa1111");
    expect(row?.detected_at).toBeTruthy();
  });

  it("a newer delivery overwrites an older detected commit", async () => {
    const { admin, rows } = createFakeAdmin();
    await recordPushDetection(admin as never, {
      organizationId: "org-1",
      projectId: PROJECT_1,
      githubRepositoryId: 123,
      detection: detection({ commitSha: "aaa1111", pushedAt: "2026-02-01T00:00:00.000Z" }),
    });
    await recordPushDetection(admin as never, {
      organizationId: "org-1",
      projectId: PROJECT_1,
      githubRepositoryId: 123,
      detection: detection({ commitSha: "bbb2222", pushedAt: "2026-02-02T00:00:00.000Z" }),
    });

    expect(rows.get(PROJECT_1)?.commit_sha).toBe("bbb2222");
  });

  it("an older, out-of-order delivery cannot overwrite a newer detected commit", async () => {
    const { admin, rows } = createFakeAdmin();
    await recordPushDetection(admin as never, {
      organizationId: "org-1",
      projectId: PROJECT_1,
      githubRepositoryId: 123,
      detection: detection({ commitSha: "bbb2222", pushedAt: "2026-02-02T00:00:00.000Z" }),
    });
    // A retried/delayed delivery for an earlier push arrives after the newer
    // one was already recorded.
    await recordPushDetection(admin as never, {
      organizationId: "org-1",
      projectId: PROJECT_1,
      githubRepositoryId: 123,
      detection: detection({ commitSha: "aaa1111", pushedAt: "2026-02-01T00:00:00.000Z" }),
    });

    expect(rows.get(PROJECT_1)?.commit_sha).toBe("bbb2222");
  });

  it("a push to a non-default branch never overwrites the default branch's detected commit", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    rows.set(PROJECT_1, { project_id: PROJECT_1, branch: "main", commit_sha: "mainhead", pushed_at: "2026-01-01T00:00:00.000Z" });
    const admin = {
      from(table: string) {
        let eqValue: unknown;
        return {
          select() { return this; },
          eq(_c: string, v: unknown) { eqValue = v; return this; },
          async maybeSingle() {
            if (table === "projects") return { data: { github_default_branch: "main" }, error: null };
            return { data: rows.get(String(eqValue)) ?? null, error: null };
          },
          async upsert(row: Record<string, unknown>) { rows.set(String(row.project_id), row); return { error: null }; },
        };
      },
    };
    await recordPushDetection(admin as never, {
      organizationId: "org-1", projectId: PROJECT_1, githubRepositoryId: 123,
      detection: detection({ commitSha: "featurehead", branch: "feature/x", pushedAt: "2026-02-01T00:00:00.000Z" }),
    });
    expect(rows.get(PROJECT_1)?.commit_sha).toBe("mainhead");
    await recordPushDetection(admin as never, {
      organizationId: "org-1", projectId: PROJECT_1, githubRepositoryId: 123,
      detection: detection({ commitSha: "newmain", branch: "main", pushedAt: "2026-02-02T00:00:00.000Z" }),
    });
    expect(rows.get(PROJECT_1)?.commit_sha).toBe("newmain");
  });
});
