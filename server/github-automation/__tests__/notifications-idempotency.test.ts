import { describe, expect, it, vi } from "vitest";

const insertCalls: unknown[] = [];
let storedIdempotencyKey: string | null = null;

vi.mock("@/server/observability/operational-events", () => ({
  emitOperationalEvent: vi.fn().mockResolvedValue(undefined),
}));

import { createSecurityNotification } from "../notifications";

describe("notification idempotency", () => {
  it("skips duplicate in-app notifications for the same scan", async () => {
    insertCalls.length = 0;
    storedIdempotencyKey = null;

    const admin = {
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, key: string) => ({
            maybeSingle: () =>
              Promise.resolve({
                data:
                  table === "operation_idempotency" && storedIdempotencyKey === key
                    ? { idempotency_key: key }
                    : null,
                error: null,
              }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          if (table === "operation_idempotency") {
            const key = row.idempotency_key as string;
            if (storedIdempotencyKey === key) {
              return Promise.resolve({ error: { code: "23505" } });
            }
            storedIdempotencyKey = key;
            return Promise.resolve({ error: null });
          }
          insertCalls.push(row);
          return Promise.resolve({ error: null });
        },
      }),
    };

    const input = {
      organizationId: "org-1",
      projectId: "proj-1",
      scanId: "scan-1",
      userId: "user-1",
      notificationType: "scan_completed" as const,
      title: "Scan complete",
      body: "Done",
    };

    await createSecurityNotification(admin as never, input);
    await createSecurityNotification(admin as never, input);

    expect(insertCalls).toHaveLength(1);
  });
});
