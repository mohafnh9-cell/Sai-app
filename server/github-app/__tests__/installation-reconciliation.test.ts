import { describe, expect, it } from "vitest";
import { processGitHubAppInstallationEvent } from "../installation-events";

type Row = Record<string, unknown>;

/**
 * Minimal in-memory fake covering exactly the query chains
 * installation-store.ts issues against `github_app_installations` and
 * `github_app_installation_repositories` -- enough to exercise the
 * installation-ID-rotation reconciliation without a real database.
 */
function createFakeAdmin(initialRows: Record<string, Row[]>) {
  const tables = initialRows;

  function matches(row: Row, filters: Array<[string, unknown, "eq" | "is"]>): boolean {
    return filters.every(([key, value, kind]) => {
      if (kind === "is") return (row[key] ?? null) === value;
      return row[key] === value;
    });
  }

  function builder(table: string) {
    const filters: Array<[string, unknown, "eq" | "is"]> = [];
    let pendingUpdate: Row | null = null;
    let pendingUpsert: { row: Row; onConflict: string } | null = null;

    const api = {
      select: () => api,
      eq: (key: string, value: unknown) => {
        filters.push([key, value, "eq"]);
        return api;
      },
      is: (key: string, value: unknown) => {
        filters.push([key, value, "is"]);
        return api;
      },
      order: () => api,
      limit: () => api,
      update: (row: Row) => {
        pendingUpdate = row;
        return api;
      },
      upsert: (row: Row, opts: { onConflict: string }) => {
        pendingUpsert = { row, onConflict: opts.onConflict };
        return api;
      },
      maybeSingle: async () => {
        const rows = tables[table]?.filter((row) => matches(row, filters)) ?? [];
        return { data: rows[0] ?? null, error: null };
      },
      single: async () => {
        const rows = tables[table]?.filter((row) => matches(row, filters)) ?? [];
        return { data: rows[0] ?? null, error: rows[0] ? null : new Error("not found") };
      },
      then: (resolve: (v: { data: Row[] | null; error: null }) => unknown) => {
        if (pendingUpdate) {
          tables[table] = (tables[table] ?? []).map((row) =>
            matches(row, filters) ? { ...row, ...pendingUpdate } : row
          );
          return Promise.resolve(resolve({ data: null, error: null }));
        }
        if (pendingUpsert) {
          const { row } = pendingUpsert;
          tables[table] = tables[table] ?? [];
          const idx = tables[table].findIndex(
            (existing) =>
              existing.installation_id === row.installation_id &&
              existing.github_repository_id === row.github_repository_id
          );
          if (idx >= 0) tables[table][idx] = { ...tables[table][idx], ...row };
          else tables[table].push({ id: `repo-${tables[table].length}`, ...row });
          return Promise.resolve(resolve({ data: [{ id: "ok" }], error: null }));
        }
        const rows = tables[table]?.filter((row) => matches(row, filters)) ?? [];
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

describe("processGitHubAppInstallationEvent — installation ID rotation", () => {
  it("migrates a stale installation row to the new GitHub installation ID when the account is unambiguous", async () => {
    const admin = createFakeAdmin({
      github_app_installations: [
        {
          id: "row-1",
          organization_id: "org-1",
          github_installation_id: 156251509,
          github_account_id: 234916357,
          github_account_login: "mohafnh9-cell",
          github_account_type: "User",
          status: "active",
          permissions_snapshot: {},
          repository_selection: "selected",
          revoked_at: null,
        },
      ],
      github_app_installation_repositories: [],
    });

    const result = await processGitHubAppInstallationEvent({
      admin,
      eventType: "installation_repositories",
      payload: {
        action: "added",
        installation: {
          id: 157921297,
          account: { id: 234916357, login: "mohafnh9-cell", type: "User" },
          repository_selection: "selected",
        },
        repositories_added: [{ id: 999, full_name: "mohafnh9-cell/sai-app" }],
      },
    });

    expect(result.action).toBe("repositories_added");

    const migrated = await admin
      .from("github_app_installations")
      .select("*")
      .eq("id", "row-1")
      .maybeSingle();
    expect((migrated.data as Row).github_installation_id).toBe(157921297);
  });

  it("does not guess when the account has more than one active installation row", async () => {
    const admin = createFakeAdmin({
      github_app_installations: [
        {
          id: "row-1",
          organization_id: "org-1",
          github_installation_id: 111,
          github_account_id: 999,
          status: "active",
          revoked_at: null,
        },
        {
          id: "row-2",
          organization_id: "org-2",
          github_installation_id: 222,
          github_account_id: 999,
          status: "active",
          revoked_at: null,
        },
      ],
      github_app_installation_repositories: [],
    });

    const result = await processGitHubAppInstallationEvent({
      admin,
      eventType: "installation_repositories",
      payload: {
        action: "added",
        installation: { id: 333, account: { id: 999, login: "someorg", type: "Organization" } },
        repositories_added: [{ id: 1, full_name: "someorg/repo" }],
      },
    });

    expect(result.action).toBe("ignored");

    const rows = await admin.from("github_app_installations").select("*").eq("github_account_id", 999);
    expect((rows.data as Row[]).map((r) => r.github_installation_id).sort()).toEqual([111, 222]);
  });
});
