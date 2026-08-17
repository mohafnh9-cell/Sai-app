import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "../stripe-webhook-idempotency";

type StripeEventRow = {
  id: string;
  stripe_event_id: string;
  event_type: string;
  status: string;
  error_message: string | null;
  processed_at: string | null;
};

function createStripeEventStore() {
  const rows: StripeEventRow[] = [];
  let nextId = 1;

  const admin = {
    from(table: string) {
      if (table !== "stripe_webhook_events") {
        throw new Error(`Unexpected table ${table}`);
      }

      const filters: Record<string, unknown> = {};
      let operation: "select" | "insert" | "update" = "select";
      let pendingInsert: Partial<StripeEventRow> | null = null;
      let pendingUpdate: Partial<StripeEventRow> | null = null;

      const execute = async () => {
        if (operation === "insert" && pendingInsert) {
          const duplicate = rows.find(
            (row) => row.stripe_event_id === pendingInsert!.stripe_event_id
          );
          if (duplicate) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value" },
            };
          }
          const row: StripeEventRow = {
            id: `stripe-${nextId++}`,
            stripe_event_id: pendingInsert.stripe_event_id!,
            event_type: pendingInsert.event_type!,
            status: pendingInsert.status ?? "processing",
            error_message: null,
            processed_at: null,
          };
          rows.push(row);
          return { data: { id: row.id }, error: null };
        }

        if (operation === "update" && pendingUpdate) {
          const row = rows.find(
            (candidate) =>
              candidate.stripe_event_id === filters.stripe_event_id &&
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
            filters.stripe_event_id == null ||
            candidate.stripe_event_id === filters.stripe_event_id
        );
        return { data: row ?? null, error: null };
      };

      const builder = {
        insert(values: Partial<StripeEventRow>) {
          operation = "insert";
          pendingInsert = values;
          return builder;
        },
        update(values: Partial<StripeEventRow>) {
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

describe("claimStripeWebhookEvent", () => {
  const baseInput = {
    stripeEventId: "evt_123",
    eventType: "checkout.session.completed",
  };

  it("claims the first event", async () => {
    const { admin } = createStripeEventStore();
    const claim = await claimStripeWebhookEvent(admin, baseInput);
    expect(claim.claimed).toBe(true);
  });

  it("rejects duplicate processed events", async () => {
    const { admin } = createStripeEventStore();
    await claimStripeWebhookEvent(admin, baseInput);
    await markStripeWebhookEventProcessed(admin, baseInput.stripeEventId);

    const duplicate = await claimStripeWebhookEvent(admin, baseInput);
    expect(duplicate.claimed).toBe(false);
    if (!duplicate.claimed) {
      expect(duplicate.reason).toBe("duplicate");
    }
  });

  it("allows only one owner under concurrent duplicate events", async () => {
    const { admin } = createStripeEventStore();
    const results = await Promise.all([
      claimStripeWebhookEvent(admin, baseInput),
      claimStripeWebhookEvent(admin, baseInput),
    ]);
    expect(results.filter((result) => result.claimed)).toHaveLength(1);
  });

  it("reclaims failed events for retry", async () => {
    const { admin, rows } = createStripeEventStore();
    await claimStripeWebhookEvent(admin, baseInput);
    await markStripeWebhookEventFailed(admin, baseInput.stripeEventId, "boom");
    expect(rows[0]?.status).toBe("failed");

    const retry = await claimStripeWebhookEvent(admin, baseInput);
    expect(retry.claimed).toBe(true);
    expect(rows[0]?.status).toBe("processing");
  });

  it("keeps different event IDs independent", async () => {
    const { admin } = createStripeEventStore();
    const first = await claimStripeWebhookEvent(admin, baseInput);
    const second = await claimStripeWebhookEvent(admin, {
      ...baseInput,
      stripeEventId: "evt_456",
    });
    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(true);
  });
});
