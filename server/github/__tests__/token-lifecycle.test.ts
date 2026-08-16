import { describe, expect, it } from "vitest";
import {
  classifyGitHubHttpAuthFailure,
  markWorkspaceGitHubTokenFailure,
} from "@/server/github/token-lifecycle";

describe("GitHub token lifecycle", () => {
  it("classifies 401 as expired and 403 as revoked", () => {
    expect(classifyGitHubHttpAuthFailure(401)).toBe("expired");
    expect(classifyGitHubHttpAuthFailure(403)).toBe("revoked");
    expect(classifyGitHubHttpAuthFailure(500)).toBeNull();
  });

  it("marks workspace connection expired without leaking token values", async () => {
    const updates: Record<string, unknown>[] = [];
    const admin = {
      from() {
        return {
          update(values: Record<string, unknown>) {
            updates.push(values);
            return {
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            };
          },
        };
      },
    };

    await markWorkspaceGitHubTokenFailure(admin as never, {
      connectionId: "conn-1",
      organizationId: "org-1",
      reason: "expired",
    });

    expect(updates[0]?.status).toBe("expired");
    expect(String(updates[0]?.last_error)).not.toMatch(/ghp_|gho_/);
  });
});
