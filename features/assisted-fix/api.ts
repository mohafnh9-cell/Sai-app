import type { FixState } from "./model";

/** Thin client for the EXISTING routes (no new backend): /api/projects/{id}/safe-fixes[/{safeFixId}]. */
export type ApiResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; code: string | null };

export type RawFixRecord = { id: string; lifecycleState: FixState; proposalCommitSha: string | null; updatedAt: string };

export type GenerateResultBody =
  | { status: "no_blockers" }
  | { status: "choose_blocker"; blockers: Array<{ id: string; title: string; severity: string }> }
  | { status: "ready"; record: { id: string }; reused?: boolean }
  | { status: "in_flight"; record: { id: string }; reason: string };

export type PanelApi = {
  list(): Promise<ApiResult<{ safeFixes: RawFixRecord[] }>>;
  generate(input: { priorityId?: string }): Promise<ApiResult<{ result: GenerateResultBody }>>;
  approve(fixId: string): Promise<ApiResult<{ state: string }>>;
  applied(fixId: string, commitSha: string): Promise<ApiResult<{ state: string; binding: string }>>;
  verify(fixId: string): Promise<
    ApiResult<{ verification: { statement: string; outcome?: string; verifiedCommitSha: string | null; details?: Record<string, unknown> } }>
  >;
  reopen(fixId: string): Promise<ApiResult<{ state: string }>>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createPanelApi(projectId: string, fetchImpl: FetchLike = (i, init) => fetch(i, init)): PanelApi {
  const base = `/api/projects/${projectId}/safe-fixes`;

  async function call<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
    try {
      const response = await fetchImpl(url, { credentials: "same-origin", ...init });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      // 409 from "generate" carries a result body (in_flight); every other non-2xx is an error code.
      if (response.ok || (response.status === 409 && body && typeof body.result === "object")) {
        return { ok: true, status: response.status, body: body as T };
      }
      return { ok: false, status: response.status, code: typeof body?.error === "string" ? (body.error as string) : null };
    } catch {
      return { ok: false, status: 503, code: "network" };
    }
  }

  const post = (url: string, body: unknown) =>
    ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) satisfies RequestInit;

  return {
    list: () => call(base, { cache: "no-store" }),
    generate: (input) => call(base, post(base, input)),
    approve: (id) => call(`${base}/${id}`, post(base, { action: "approve" })),
    applied: (id, commitSha) => call(`${base}/${id}`, post(base, { action: "applied", commitSha })),
    verify: (id) => call(`${base}/${id}`, post(base, { action: "verify" })),
    reopen: (id) => call(`${base}/${id}`, post(base, { action: "reopen" })),
  };
}
