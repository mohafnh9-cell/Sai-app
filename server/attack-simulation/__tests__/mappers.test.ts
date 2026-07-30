import { describe, expect, it } from "vitest";
import {
  attackCampaignSchema,
  attackExecutionSchema,
  attackRuntimeEventSchema,
  mapAttackCampaignRow,
  mapAttackExecutionRow,
  mapAttackExecutionStepRow,
  mapAttackRuntimeEventRow,
  serializeAttackRuntimeEventForRealtime,
} from "@/server/attack-simulation";

describe("attack simulation mappers", () => {
  const now = "2026-07-30T09:00:00.000Z";

  it("maps campaign rows with campaign-level progress fields", () => {
    const mapped = mapAttackCampaignRow({
      id: "11111111-1111-4111-8111-111111111111",
      scan_id: "44444444-4444-4444-8444-444444444444",
      scan_job_id: null,
      project_id: "55555555-5555-4555-8555-555555555555",
      organization_id: "66666666-6666-4666-8666-666666666666",
      commit_sha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtime_mode: "mock",
      status: "running",
      correlation_id: "11111111-1111-4111-8111-111111111111",
      authorization_id: null,
      progress_percent: 42,
      estimated_remaining_ms: 15000,
      total_scenarios: 10,
      total_executions: 10,
      completed_executions: 4,
      confirmed_findings: 1,
      blocked_executions: 0,
      started_at: now,
      completed_at: null,
      cancelled_at: null,
      failure_code: null,
      safe_failure_message: null,
      created_at: now,
      updated_at: now,
    });

    const parsed = attackCampaignSchema.parse(mapped);
    expect(parsed.progressPercent).toBe(42);
    expect(parsed.estimatedRemainingMs).toBe(15000);
  });

  it("maps execution rows with live UI fields", () => {
    const mapped = mapAttackExecutionRow({
      id: "22222222-2222-4222-8222-222222222222",
      campaign_id: "11111111-1111-4111-8111-111111111111",
      scenario_id: "33333333-3333-4333-8333-333333333333",
      scan_id: "44444444-4444-4444-8444-444444444444",
      scan_job_id: null,
      project_id: "55555555-5555-4555-8555-555555555555",
      organization_id: "66666666-6666-4666-8666-666666666666",
      commit_sha: "67e0cc53e3dbc4dcd04bb4a8ab3220eb453d5f1b",
      runtime_mode: "mock",
      correlation_id: "11111111-1111-4111-8111-111111111111",
      attacker_profile: { role: "tenant_b" },
      protected_assets: [{ type: "record", id: "redacted" }],
      status: "executing",
      current_stage: "executing",
      current_step_id: "33333333-3333-4333-8333-333333333333",
      current_step_title: "Execute request",
      progress_percent: 55,
      estimated_remaining_ms: 9000,
      elapsed_ms: 4100,
      started_at: now,
      updated_at: now,
      completed_at: null,
      cancelled_at: null,
      failure_code: null,
      safe_failure_message: null,
      created_at: now,
    });

    const parsed = attackExecutionSchema.parse(mapped);
    expect(parsed.elapsedMs).toBe(4100);
    expect(parsed.currentStepTitle).toBe("Execute request");
  });

  it("maps step rows with weight and duration", () => {
    const mapped = mapAttackExecutionStepRow({
      id: "33333333-3333-4333-8333-333333333333",
      execution_id: "22222222-2222-4222-8222-222222222222",
      campaign_id: "11111111-1111-4111-8111-111111111111",
      organization_id: "66666666-6666-4666-8666-666666666666",
      project_id: "55555555-5555-4555-8555-555555555555",
      sort_order: 3,
      kind: "execute_request",
      label: "Execute request",
      weight: 25,
      status: "completed",
      started_at: now,
      completed_at: now,
      duration_ms: 800,
      failure_code: null,
      metadata: {},
      created_at: now,
      updated_at: now,
    });

    expect(mapped.weight).toBe(25);
    expect(mapped.durationMs).toBe(800);
  });

  it("serializes runtime events for Realtime consumers", () => {
    const mapped = mapAttackRuntimeEventRow({
      id: "77777777-7777-4777-8777-777777777777",
      campaign_id: "11111111-1111-4111-8111-111111111111",
      execution_id: "22222222-2222-4222-8222-222222222222",
      step_id: "33333333-3333-4333-8333-333333333333",
      organization_id: "66666666-6666-4666-8666-666666666666",
      project_id: "55555555-5555-4555-8555-555555555555",
      correlation_id: "11111111-1111-4111-8111-111111111111",
      event_type: "attack_step_completed",
      payload: { progressPercent: 55, stepLabel: "Execute request" },
      occurred_at: now,
      created_at: now,
    });

    const event = attackRuntimeEventSchema.parse(mapped);
    const serialized = serializeAttackRuntimeEventForRealtime(event);
    expect(serialized.eventType).toBe("attack_step_completed");
    expect(serialized.payload.progressPercent).toBe(55);
  });
});
