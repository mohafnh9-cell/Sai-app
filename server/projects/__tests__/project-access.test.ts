import { describe, expect, it, vi } from "vitest";
import { getProjectAccessForUser } from "../project-access";

describe("getProjectAccessForUser", () => {
  it("returns null when project is missing", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    };
    const result = await getProjectAccessForUser(client as never, "proj-1", "user-1");
    expect(result).toBeNull();
  });

  it("returns null when user is not a member", async () => {
    let call = 0;
    const client = {
      from: vi.fn((table: string) => {
        call += 1;
        if (table === "projects") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: "proj-1", organization_id: "org-1", name: "Demo" },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
    const result = await getProjectAccessForUser(client as never, "proj-1", "user-1");
    expect(result).toBeNull();
    expect(call).toBe(2);
  });
});
