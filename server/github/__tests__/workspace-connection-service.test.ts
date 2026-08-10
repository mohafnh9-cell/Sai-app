import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceGitHubToken } from "@/server/github/workspace-connection-service";
import { encryptToken } from "@/lib/crypto/token-encryption";

type Row = Record<string, unknown>;

function createAdmin(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      let filters: Array<{ col: string; value: unknown }> = [];
      let pendingUpdate: Row | null = null;

      const builder = {
        select() {
          return builder;
        },
        update(values: Row) {
          pendingUpdate = values;
          return builder;
        },
        eq(col: string, value: unknown) {
          filters.push({ col, value });
          return builder;
        },
        then(
          resolve: (value: { data: null; error: null }) => unknown
        ) {
          if (pendingUpdate) {
            for (const row of rows.filter((candidate) =>
              filters.every((filter) => candidate[filter.col] === filter.value)
            )) {
              Object.assign(row, pendingUpdate);
            }
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
        maybeSingle: async () => {
          const match = rows.find((row) =>
            filters.every((filter) => row[filter.col] === filter.value)
          );
          return { data: match ?? null, error: null };
        },
      };

      return builder;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveWorkspaceGitHubToken", () => {
  it("returns the Workspace connection token for the requested organization", async () => {
    const admin = createAdmin({
      workspace_github_connections: [
        {
          id: "conn-a",
          organization_id: "org-a",
          connected_by_user_id: "user-a",
          access_token: "token-a",
          status: "active",
        },
      ],
    });

    const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a");
    expect(resolved).toEqual({
      token: "token-a",
      userId: "user-a",
      connectionId: "conn-a",
    });
  });

  it("uses the project-linked connection when it belongs to the same Workspace", async () => {
    const admin = createAdmin({
      projects: [
        {
          id: "project-a",
          organization_id: "org-a",
          github_connection_id: "conn-a",
          connected_by_user_id: "user-a",
        },
      ],
      workspace_github_connections: [
        {
          id: "conn-a",
          organization_id: "org-a",
          connected_by_user_id: "user-a",
          access_token: "token-a",
          status: "active",
        },
      ],
    });

    const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a", "project-a");
    expect(resolved?.connectionId).toBe("conn-a");
  });

  it("denies cross-Workspace token access when the project belongs elsewhere", async () => {
    const admin = createAdmin({
      projects: [
        {
          id: "project-b",
          organization_id: "org-b",
          github_connection_id: "conn-b",
          connected_by_user_id: "user-b",
        },
      ],
      workspace_github_connections: [
        {
          id: "conn-a",
          organization_id: "org-a",
          connected_by_user_id: "user-a",
          access_token: "token-a",
          status: "active",
        },
      ],
    });

    const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a", "project-b");
    expect(resolved).toBeNull();
  });

  it("does not return revoked or inactive connections", async () => {
    const admin = createAdmin({
      workspace_github_connections: [
        {
          id: "conn-a",
          organization_id: "org-a",
          connected_by_user_id: "user-a",
          access_token: "token-a",
          status: "revoked",
        },
      ],
    });

    const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a");
    expect(resolved).toBeNull();
  });

  it("marks an unreadable encrypted token as requiring reconnection", async () => {
    const previousKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const connection = {
      id: "conn-a",
      organization_id: "org-a",
      connected_by_user_id: "user-a",
      access_token: "enc:v1:not-valid-ciphertext",
      status: "active",
      last_error: null,
    };
    const admin = createAdmin({
      workspace_github_connections: [connection],
    });

    try {
      const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a");

      expect(resolved).toBeNull();
      expect(connection.status).toBe("migration_reconnection_required");
      expect(connection.last_error).toBe("GitHub connection requires reauthorization.");
    } finally {
      if (previousKey) {
        process.env.GITHUB_TOKEN_ENCRYPTION_KEY = previousKey;
      } else {
        delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
      }
    }
  });

  it("requires OAuth reconnection when an encrypted token cannot be decrypted locally", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GITHUB_TOKEN_ENCRYPTION_KEY", "");
    const connection = {
      id: "conn-a",
      organization_id: "org-a",
      connected_by_user_id: "user-a",
      access_token: "enc:v1:production-ciphertext",
      status: "active",
      last_error: null,
    };
    const admin = createAdmin({
      workspace_github_connections: [connection],
    });

    const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a");

    expect(resolved).toBeNull();
    expect(connection.status).toBe("migration_reconnection_required");
    expect(connection.last_error).toBe("GitHub connection requires reauthorization.");
  });

  it("preserves the connection and project data when rotation makes ciphertext unreadable", async () => {
    const previousKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    const oldKey = Buffer.alloc(32, 3).toString("base64");
    const newKey = Buffer.alloc(32, 4).toString("base64");
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = oldKey;
    const oldCiphertext = encryptToken("github-sensitive-test-token");
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = newKey;

    const connection = {
      id: "conn-a",
      organization_id: "org-a",
      connected_by_user_id: "user-a",
      access_token: oldCiphertext,
      status: "active",
      last_error: null,
    };
    const project = {
      id: "project-a",
      organization_id: "org-a",
      github_connection_id: "conn-a",
      github_repo: "owner/repository",
    };
    const finding = {
      id: "finding-a",
      project_id: "project-a",
      title: "Existing finding",
    };
    const projectBefore = { ...project };
    const findingBefore = { ...finding };
    const tables = {
      workspace_github_connections: [connection],
      projects: [project],
      scan_findings: [finding],
    };
    const admin = createAdmin(tables);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const resolved = await resolveWorkspaceGitHubToken(
        admin as never,
        "org-a"
      );

      expect(resolved).toBeNull();
      expect(tables.workspace_github_connections).toHaveLength(1);
      expect(connection.id).toBe("conn-a");
      expect(connection.access_token).toBe(oldCiphertext);
      expect(connection.status).toBe("migration_reconnection_required");
      expect(project).toEqual(projectBefore);
      expect(finding).toEqual(findingBefore);

      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain("token_decryption_failed");
      expect(logged).not.toContain("github-sensitive-test-token");
      expect(logged).not.toContain(oldCiphertext);
      expect(logged).not.toContain(oldKey);
      expect(logged).not.toContain(newKey);
    } finally {
      warn.mockRestore();
      if (previousKey) {
        process.env.GITHUB_TOKEN_ENCRYPTION_KEY = previousKey;
      } else {
        delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
      }
    }
  });

  it("reactivates a recoverable encrypted connection after key synchronization", async () => {
    const previousKey = process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const connection = {
      id: "conn-a",
      organization_id: "org-a",
      connected_by_user_id: "user-a",
      access_token: encryptToken("github-token"),
      status: "migration_reconnection_required",
      last_error: "Reconnect GitHub",
    };
    const admin = createAdmin({
      workspace_github_connections: [connection],
    });

    try {
      const resolved = await resolveWorkspaceGitHubToken(admin as never, "org-a");

      expect(resolved?.token).toBe("github-token");
      expect(connection.status).toBe("active");
      expect(connection.last_error).toBeNull();
    } finally {
      if (previousKey) {
        process.env.GITHUB_TOKEN_ENCRYPTION_KEY = previousKey;
      } else {
        delete process.env.GITHUB_TOKEN_ENCRYPTION_KEY;
      }
    }
  });
});
