import { describe, expect, it, vi, beforeEach } from "vitest";

const sendCriticalVulnerabilityEmailMock = vi.fn();

vi.mock("@/lib/resend", () => ({
  sendCriticalVulnerabilityEmail: (...args: unknown[]) =>
    sendCriticalVulnerabilityEmailMock(...args),
}));

function adminMock(input: { ownerUserId?: string | null; email?: string | null }) {
  return {
    from: (table: string) => {
      if (table === "organization_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: input.ownerUserId ? { user_id: input.ownerUserId } : null,
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: input.email !== undefined ? { email: input.email } : null,
                  error: null,
                }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("notifyOwnerOfCriticalAlert — M7", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the critical vulnerability email to the resolved organization owner", async () => {
    sendCriticalVulnerabilityEmailMock.mockResolvedValue({ sent: true });
    const { notifyOwnerOfCriticalAlert } = await import("../notify-owner");
    const admin = adminMock({ ownerUserId: "user-1", email: "owner@acme.com" });

    await notifyOwnerOfCriticalAlert(admin as never, {
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Acme App",
      alertId: "alert-1",
      titlePlain: "Exposed API key found",
    });

    expect(sendCriticalVulnerabilityEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "owner@acme.com",
        projectName: "Acme App",
        vulnerabilityTitle: "Exposed API key found",
        vulnerabilityId: "alert-1",
      })
    );
  });

  it("does not throw and does not attempt to send when no owner email can be resolved", async () => {
    const { notifyOwnerOfCriticalAlert } = await import("../notify-owner");
    const admin = adminMock({ ownerUserId: null });

    await expect(
      notifyOwnerOfCriticalAlert(admin as never, {
        organizationId: "org-1",
        projectId: "project-1",
        projectName: "Acme App",
        alertId: "alert-1",
        titlePlain: "Exposed API key found",
      })
    ).resolves.toBeUndefined();
    expect(sendCriticalVulnerabilityEmailMock).not.toHaveBeenCalled();
  });

  it("never throws even when the underlying send rejects (email failure must not fail the caller)", async () => {
    sendCriticalVulnerabilityEmailMock.mockRejectedValue(new Error("Resend API error"));
    const { notifyOwnerOfCriticalAlert } = await import("../notify-owner");
    const admin = adminMock({ ownerUserId: "user-1", email: "owner@acme.com" });

    await expect(
      notifyOwnerOfCriticalAlert(admin as never, {
        organizationId: "org-1",
        projectId: "project-1",
        projectName: "Acme App",
        alertId: "alert-1",
        titlePlain: "Exposed API key found",
      })
    ).resolves.toBeUndefined();
  });
});
