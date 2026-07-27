export type RedTeamRunStatus =
  | "requested"
  | "authorization_check"
  | "queued"
  | "provisioning"
  | "exploring"
  | "testing"
  | "validating"
  | "completed"
  | "partially_completed"
  | "failed"
  | "timed_out"
  | "cancelled";

export type RedTeamRunRecord = {
  id: string;
  organizationId: string;
  projectId: string;
  authorizationId: string | null;
  idempotencyKey: string | null;
  status: RedTeamRunStatus;
  commitSha: string | null;
  targetOrigin: string | null;
  environmentType: string | null;
  discoveryReportId: string | null;
  executionLeaseToken: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RedTeamRunStore = {
  create(input: Omit<RedTeamRunRecord, "createdAt" | "updatedAt">): Promise<RedTeamRunRecord>;
  updateStatus(id: string, status: RedTeamRunStatus, patch?: Partial<RedTeamRunRecord>): Promise<RedTeamRunRecord>;
  getById(id: string): Promise<RedTeamRunRecord | null>;
  findActiveByIdempotency(projectId: string, idempotencyKey: string): Promise<RedTeamRunRecord | null>;
};

export class InMemoryRedTeamRunStore implements RedTeamRunStore {
  private readonly runs = new Map<string, RedTeamRunRecord>();

  async create(input: Omit<RedTeamRunRecord, "createdAt" | "updatedAt">): Promise<RedTeamRunRecord> {
    const now = new Date().toISOString();
    const row: RedTeamRunRecord = { ...input, createdAt: now, updatedAt: now };
    this.runs.set(row.id, row);
    return row;
  }

  async updateStatus(
    id: string,
    status: RedTeamRunStatus,
    patch?: Partial<RedTeamRunRecord>
  ): Promise<RedTeamRunRecord> {
    const existing = this.runs.get(id);
    if (!existing) throw new Error(`Red team run not found: ${id}`);
    const updated = {
      ...existing,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.runs.set(id, updated);
    return updated;
  }

  async getById(id: string): Promise<RedTeamRunRecord | null> {
    return this.runs.get(id) ?? null;
  }

  async findActiveByIdempotency(
    projectId: string,
    idempotencyKey: string
  ): Promise<RedTeamRunRecord | null> {
    for (const run of this.runs.values()) {
      if (run.projectId !== projectId || run.idempotencyKey !== idempotencyKey) continue;
      if (
        ![
          "completed",
          "partially_completed",
          "failed",
          "timed_out",
          "cancelled",
        ].includes(run.status)
      ) {
        return run;
      }
    }
    return null;
  }
}
