import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimDeliveryEvent,
  ensureDeliveryProcessing,
  isDeliveryAlreadyHandled,
  isTerminalDeliveryStatus,
  updateDeliveryEventStatus,
} from "../delivery-idempotency";

type DeliveryRow = {
  id: string;
  organization_id: string;
  project_id: string;
  github_delivery_id: string;
  event_type: string;
  status: string;
  payload: Record<string, unknown>;
  error_message: string | null;
  processed_at: string | null;
};

function createDeliveryStore() {
  const rows: DeliveryRow[] = [];
  let nextId = 1;

  const admin = {
    from(table: string) {
      if (table !== "repository_events") {
        throw new Error(`Unexpected table ${table}`);
      }

      const filters: Record<string, unknown> = {};
      let pendingInsert: Partial<DeliveryRow> | null = null;
      let pendingUpdate: Partial<DeliveryRow> | null = null;
      let operation: "select" | "insert" | "update" = "select";

      const execute = async () => {
          if (operation === "insert" && pendingInsert) {
            const duplicate = rows.find(
              (row) =>
                row.organization_id === pendingInsert!.organization_id &&
                row.github_delivery_id === pendingInsert!.github_delivery_id
            );
            if (duplicate) {
              return {
                data: null,
                error: { code: "23505", message: "duplicate key value" },
              };
            }
            const row: DeliveryRow = {
              id: `event-${nextId++}`,
              organization_id: pendingInsert.organization_id!,
              project_id: pendingInsert.project_id!,
              github_delivery_id: pendingInsert.github_delivery_id!,
              event_type: pendingInsert.event_type!,
              status: pendingInsert.status ?? "processing",
              payload: (pendingInsert.payload as Record<string, unknown>) ?? {},
              error_message: null,
              processed_at: null,
            };
            rows.push(row);
            return { data: { id: row.id }, error: null };
          }

          if (operation === "update" && pendingUpdate) {
            const row = rows.find(
              (candidate) =>
                candidate.organization_id === filters.organization_id &&
                candidate.github_delivery_id === filters.github_delivery_id &&
                (filters.status == null || candidate.status === filters.status)
            );
            if (!row) {
              return { data: null, error: null };
            }
            Object.assign(row, pendingUpdate);
            return { data: { id: row.id }, error: null };
          }

          const row = rows.find(
            (candidate) =>
              (filters.organization_id == null ||
                candidate.organization_id === filters.organization_id) &&
              (filters.github_delivery_id == null ||
                candidate.github_delivery_id === filters.github_delivery_id)
          );
          if (!row) {
            return { data: null, error: null };
          }
          if (filters.status != null && row.status !== filters.status) {
            return { data: null, error: null };
          }
          return { data: row, error: null };
      };

      const builder = {
        insert(values: Partial<DeliveryRow>) {
          operation = "insert";
          pendingInsert = values;
          return builder;
        },
        update(values: Partial<DeliveryRow>) {
          operation = "update";
          pendingUpdate = values;
          return builder;
        },
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return builder;
        },
        maybeSingle: execute,
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return execute().then(onFulfilled, onRejected);
        },
      };

      return builder;
    },
  };

  return { admin: admin as unknown as SupabaseClient, rows };
}

describe("isTerminalDeliveryStatus", () => {
  it("treats processed, failed, and ignored as terminal", () => {
    expect(isTerminalDeliveryStatus("processed")).toBe(true);
    expect(isTerminalDeliveryStatus("failed")).toBe(true);
    expect(isTerminalDeliveryStatus("ignored")).toBe(true);
  });

  it("treats in-flight statuses as non-terminal", () => {
    expect(isTerminalDeliveryStatus("processing")).toBe(false);
    expect(isTerminalDeliveryStatus("received")).toBe(false);
  });
});

describe("claimDeliveryEvent", () => {
  const baseInput = {
    organizationId: "org-a",
    projectId: "project-a",
    deliveryId: "delivery-1",
    eventType: "push",
    payload: { ref: "refs/heads/main" },
  };

  it("claims the first delivery successfully", async () => {
    const { admin } = createDeliveryStore();
    const result = await claimDeliveryEvent(admin, baseInput);
    expect(result.claimed).toBe(true);
    if (result.claimed) {
      expect(result.status).toBe("processing");
      expect(result.eventId).toBeTruthy();
    }
  });

  it("rejects a second identical delivery as duplicate/in-flight", async () => {
    const { admin } = createDeliveryStore();
    const first = await claimDeliveryEvent(admin, baseInput);
    expect(first.claimed).toBe(true);

    const second = await claimDeliveryEvent(admin, baseInput);
    expect(second.claimed).toBe(false);
    if (!second.claimed) {
      expect(second.reason).toBe("in_flight");
      expect(second.status).toBe("processing");
    }
  });

  it("allows only one owner under concurrent duplicate deliveries", async () => {
    const { admin } = createDeliveryStore();
    const results = await Promise.all([
      claimDeliveryEvent(admin, baseInput),
      claimDeliveryEvent(admin, baseInput),
    ]);

    const owners = results.filter((result) => result.claimed);
    expect(owners).toHaveLength(1);
    expect(results.some((result) => !result.claimed)).toBe(true);
  });

  it("reclaims failed deliveries for retry", async () => {
    const { admin, rows } = createDeliveryStore();
    const first = await claimDeliveryEvent(admin, baseInput);
    expect(first.claimed).toBe(true);

    await updateDeliveryEventStatus(admin, {
      organizationId: baseInput.organizationId,
      deliveryId: baseInput.deliveryId,
      status: "failed",
      errorMessage: "boom",
    });
    expect(rows[0]?.status).toBe("failed");

    const retry = await claimDeliveryEvent(admin, baseInput);
    expect(retry.claimed).toBe(true);
    expect(rows[0]?.status).toBe("processing");
  });

  it("does not reprocess processed deliveries", async () => {
    const { admin } = createDeliveryStore();
    const first = await claimDeliveryEvent(admin, baseInput);
    expect(first.claimed).toBe(true);

    await updateDeliveryEventStatus(admin, {
      organizationId: baseInput.organizationId,
      deliveryId: baseInput.deliveryId,
      status: "processed",
    });

    const second = await claimDeliveryEvent(admin, baseInput);
    expect(second.claimed).toBe(false);
    if (!second.claimed) {
      expect(second.reason).toBe("duplicate");
      expect(second.status).toBe("processed");
    }
  });

  it("keeps different delivery IDs independent", async () => {
    const { admin } = createDeliveryStore();
    const first = await claimDeliveryEvent(admin, baseInput);
    const second = await claimDeliveryEvent(admin, {
      ...baseInput,
      deliveryId: "delivery-2",
    });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(true);
  });

  it("scopes delivery IDs per organization", async () => {
    const { admin } = createDeliveryStore();
    const orgA = await claimDeliveryEvent(admin, baseInput);
    const orgB = await claimDeliveryEvent(admin, {
      ...baseInput,
      organizationId: "org-b",
      projectId: "project-b",
    });
    expect(orgA.claimed).toBe(true);
    expect(orgB.claimed).toBe(true);
  });
});

describe("ensureDeliveryProcessing", () => {
  const baseInput = {
    organizationId: "org-a",
    projectId: "project-a",
    deliveryId: "delivery-1",
    eventType: "push",
    payload: { ref: "refs/heads/main" },
  };

  it("allows orchestrator continuation when ingress already claimed processing", async () => {
    const { admin } = createDeliveryStore();
    const claim = await claimDeliveryEvent(admin, baseInput);
    expect(claim.claimed).toBe(true);

    const gate = await ensureDeliveryProcessing(admin, baseInput);
    expect(gate.shouldProcess).toBe(true);
  });

  it("rejects duplicate terminal deliveries", async () => {
    const { admin } = createDeliveryStore();
    await claimDeliveryEvent(admin, baseInput);
    await updateDeliveryEventStatus(admin, {
      organizationId: baseInput.organizationId,
      deliveryId: baseInput.deliveryId,
      status: "processed",
    });

    expect(
      await isDeliveryAlreadyHandled(
        admin,
        baseInput.organizationId,
        baseInput.deliveryId
      )
    ).toBe(true);

    const gate = await ensureDeliveryProcessing(admin, baseInput);
    expect(gate.shouldProcess).toBe(false);
    if (!gate.shouldProcess) {
      expect(gate.reason).toBe("duplicate");
    }
  });
});
