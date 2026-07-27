import { describe, expect, it } from "vitest";
import { InMemoryRedTeamRunStore } from "../runs/red-team-run-store";
import { randomUUID } from "node:crypto";

describe("Red team job orchestration (mock workers)", () => {
  it("supports idempotent duplicate submission", async () => {
    const store = new InMemoryRedTeamRunStore();
    const idempotencyKey = "commit:abc:preview";
    const projectId = "project-1";

    const first = await store.create({
      id: randomUUID(),
      organizationId: "org-1",
      projectId,
      authorizationId: null,
      idempotencyKey,
      status: "queued",
      commitSha: "abc",
      targetOrigin: "https://preview.example.com",
      environmentType: "preview",
      discoveryReportId: null,
      executionLeaseToken: null,
      metadata: {},
    });

    const active = await store.findActiveByIdempotency(projectId, idempotencyKey);
    expect(active?.id).toBe(first.id);
  });

  it("handles many queued runs without losing terminal state updates", async () => {
    const store = new InMemoryRedTeamRunStore();
    const ids: string[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await store.create({
        id,
        organizationId: "org-1",
        projectId: "project-1",
        authorizationId: null,
        idempotencyKey: null,
        status: "queued",
        commitSha: null,
        targetOrigin: null,
        environmentType: null,
        discoveryReportId: null,
        executionLeaseToken: null,
        metadata: {},
      });
    }
    for (const id of ids) {
      await store.updateStatus(id, "completed");
    }
    const completed = await Promise.all(ids.map((id) => store.getById(id)));
    expect(completed.every((run) => run?.status === "completed")).toBe(true);
  });
});
