import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptToken, encryptToken } from "@/lib/crypto/token-encryption";
import {
  resolveWorkspaceGitHubToken,
  upsertWorkspaceGitHubConnection,
} from "@/server/github/workspace-connection-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getGitHubTokenScopes, getGitHubUser } from "@/lib/github";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/github", () => ({
  getGitHubTokenScopes: vi.fn(),
  getGitHubUser: vi.fn(),
}));

type Row = Record<string, unknown>;

function createRotationAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Array<{ col: string; value: unknown }> = [];
      const notNullColumns: string[] = [];
      let pendingUpdate: Row | null = null;
      let pendingUpsert: Row | null = null;

      const matches = (row: Row) =>
        filters.every((filter) => row[filter.col] === filter.value) &&
        notNullColumns.every((column) => row[column] !== null);

      const applyUpdate = () => {
        if (!pendingUpdate) return;
        for (const row of rows.filter(matches)) {
          Object.assign(row, pendingUpdate);
        }
      };

      const builder = {
        select() {
          return builder;
        },
        update(values: Row) {
          pendingUpdate = values;
          return builder;
        },
        upsert(values: Row) {
          pendingUpsert = values;
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push({ col, value });
          return builder;
        },
        not(col: string) {
          notNullColumns.push(col);
          return builder;
        },
        maybeSingle: async () => {
          const match = rows.find(matches);
          return { data: match ?? null, error: null };
        },
        single: async () => {
          if (!pendingUpsert) {
            return { data: rows.find(matches) ?? null, error: null };
          }

          const existing = rows.find(
            (row) => row.organization_id === pendingUpsert?.organization_id
          );
          if (existing) {
            Object.assign(existing, pendingUpsert);
            return { data: { id: existing.id }, error: null };
          }

          const created = { id: "conn-created", ...pendingUpsert };
          rows.push(created);
          return { data: { id: created.id }, error: null };
        },
        then(
          resolve: (value: { data: null; error: null }) => unknown,
          reject?: (reason: unknown) => unknown
        ) {
          applyUpdate();
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };

      return builder;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
});

describe("controlled GitHub token key rotation", () => {
  it("reuses the OAuth connection row, encrypts new tokens, and restores repository access", async () => {
    const oldKey = Buffer.alloc(32, 5).toString("base64");
    const replacementKey = Buffer.alloc(32, 6).toString("base64");
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = oldKey;
    const unreadableAccessToken = encryptToken("old-access-test-token");
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = replacementKey;

    const connection: Row = {
      id: "conn-a",
      organization_id: "org-a",
      connected_by_user_id: "user-a",
      github_user_id: 100,
      github_login: "existing-user",
      github_account_type: "User",
      access_token: unreadableAccessToken,
      refresh_token: null,
      token_scopes: ["repo"],
      status: "migration_reconnection_required",
      last_error: "GitHub connection requires reauthorization.",
    };
    const project: Row = {
      id: "project-a",
      organization_id: "org-a",
      github_connection_id: "conn-a",
      connected_by_user_id: "user-a",
      github_repository_id: 200,
      github_repo: "owner/repository",
      configuration: { protected: true },
    };
    const finding: Row = {
      id: "finding-a",
      project_id: "project-a",
      title: "Existing finding",
      status: "open",
    };
    const projectBefore = structuredClone(project);
    const findingBefore = structuredClone(finding);
    const tables = {
      workspace_github_connections: [connection],
      projects: [project],
      scan_findings: [finding],
    };
    const admin = createRotationAdmin(tables);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);
    vi.mocked(getGitHubUser).mockResolvedValue({
      id: 100,
      login: "existing-user",
      type: "User",
    } as never);
    vi.mocked(getGitHubTokenScopes).mockResolvedValue(["repo"]);

    const result = await upsertWorkspaceGitHubConnection({
      organizationId: "org-a",
      connectedByUserId: "user-a",
      accessToken: "new-access-test-token",
      refreshToken: "new-refresh-test-token",
    });

    expect(result.connectionId).toBe("conn-a");
    expect(tables.workspace_github_connections).toHaveLength(1);
    expect(connection.status).toBe("active");
    expect(connection.last_error).toBeNull();
    expect(connection.access_token).not.toBe("new-access-test-token");
    expect(connection.refresh_token).not.toBe("new-refresh-test-token");
    expect(String(connection.access_token)).toMatch(/^enc:v1:/);
    expect(String(connection.refresh_token)).toMatch(/^enc:v1:/);
    expect(decryptToken(String(connection.access_token))).toBe(
      "new-access-test-token"
    );
    expect(decryptToken(String(connection.refresh_token))).toBe(
      "new-refresh-test-token"
    );

    expect(project).toEqual(projectBefore);
    expect(finding).toEqual(findingBefore);

    const resolved = await resolveWorkspaceGitHubToken(
      admin as never,
      "org-a",
      "project-a"
    );
    expect(resolved).toEqual({
      token: "new-access-test-token",
      userId: "user-a",
      connectionId: "conn-a",
    });
  });
});
