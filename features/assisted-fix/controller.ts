import type { GenerateResultBody, PanelApi, ApiResult } from "./api";
import { checkCommitInput, errorKeyFor, type CommitCheck, type PanelData, type PanelErrorKey, type PanelFix } from "./model";

/**
 * The panel's behaviour as a plain store (no React, injected API) so the whole journey is testable in a node environment.
 *
 * Guarantees the tests pin down:
 *  - the displayed state is ALWAYS what the server returned (every action is followed by a re-read; no optimistic updates);
 *  - the commit is never preselected and `applied` is sent only after an explicit `confirmCommit` on a valid, checked SHA;
 *  - every error is translated to a stable key and the panel re-reads the persisted state after ANY non-2xx.
 */
export type PanelBlocker = { id: string; title: string; severity: string };

export type CommitFlow = { fixId: string; input: string; step: "enter" | "confirm"; check: CommitCheck | null };

export type PanelState = {
  data: PanelData;
  busy: string | null;
  error: { key: PanelErrorKey; fixId: string | null } | null;
  notice: "no_blockers" | "created" | "reused" | null;
  chooseBlocker: PanelBlocker[] | null;
  commitFlow: CommitFlow | null;
};

export type ControllerOptions = {
  api: PanelApi;
  initial: PanelData;
  /** Asks the host to re-render server data (analyses, verification details) after a state change. */
  onReload?: () => void;
};

export function createAssistedFixController(options: ControllerOptions) {
  const { api, onReload } = options;
  let state: PanelState = { data: options.initial, busy: null, error: null, notice: null, chooseBlocker: null, commitFlow: null };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<PanelState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const setData = (data: PanelData) => set({ data });

  /** Re-reads the persisted records and merges their state; asks the host for enriched data when something changed. */
  async function refresh(): Promise<void> {
    const result = await api.list();
    if (!result.ok) return;
    let changed = false;
    const byId = new Map(result.body.safeFixes.map((record) => [record.id, record]));
    const fixes: PanelFix[] = state.data.fixes.map((fix) => {
      const record = byId.get(fix.id);
      if (!record) return fix;
      if (record.lifecycleState !== fix.state || record.updatedAt !== fix.updatedAt) changed = true;
      return { ...fix, state: record.lifecycleState, updatedAt: record.updatedAt, reportedCommitSha: record.proposalCommitSha };
    });
    const knownIds = new Set(state.data.fixes.map((fix) => fix.id));
    if (result.body.safeFixes.some((record) => !knownIds.has(record.id))) changed = true;
    setData({ ...state.data, fixes });
    if (changed) onReload?.();
  }

  async function run<T>(label: string, fixId: string | null, action: () => Promise<ApiResult<T>>): Promise<ApiResult<T>> {
    set({ busy: label, error: null, notice: null });
    const result = await action();
    if (!result.ok) {
      set({ error: { key: errorKeyFor({ status: result.status, code: result.code }), fixId } });
    }
    // Always re-read: after ANY non-200 the persisted state may still have changed (see mapSafeFixError).
    await refresh();
    set({ busy: null });
    return result;
  }

  function handleGenerate(result: GenerateResultBody) {
    switch (result.status) {
      case "no_blockers":
        set({ notice: "no_blockers", chooseBlocker: null });
        return;
      case "choose_blocker":
        set({ chooseBlocker: result.blockers, notice: null });
        return;
      case "ready":
        set({ notice: result.reused ? "reused" : "created", chooseBlocker: null });
        return;
      case "in_flight":
        set({ error: { key: "in_flight", fixId: result.record.id }, chooseBlocker: null });
        return;
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    /** Adopts fresh server-rendered data (analyses, verification details). The server is the source of truth. */
    adopt(data: PanelData) {
      setData(data);
    },

    /** "Generar propuesta": reuses the existing create route and its repeat controls (it may reuse or refuse). */
    async generate(priorityId?: string) {
      const result = await run("generate", null, () => api.generate(priorityId ? { priorityId } : {}));
      if (result.ok) handleGenerate(result.body.result);
    },
    cancelChoice() {
      set({ chooseBlocker: null });
    },

    async approve(fixId: string) {
      await run("approve", fixId, () => api.approve(fixId));
    },
    async reopen(fixId: string) {
      await run("reopen", fixId, () => api.reopen(fixId));
    },

    // --- reporting the commit: enter -> confirm (explicit) -> applied ----------------------------------------------
    startCommit(fixId: string) {
      // No default value, whatever the suggestion is.
      set({ commitFlow: { fixId, input: "", step: "enter", check: null }, error: null });
    },
    setCommitInput(input: string) {
      if (!state.commitFlow) return;
      set({ commitFlow: { ...state.commitFlow, input, step: "enter", check: null } });
    },
    /** The suggestion card only FILLS the field; the person still reviews and confirms. It is never submitted. */
    useSuggestion() {
      if (!state.commitFlow || !state.data.suggestion) return;
      set({ commitFlow: { ...state.commitFlow, input: state.data.suggestion.commitSha, step: "enter", check: null } });
    },
    reviewCommit() {
      const flow = state.commitFlow;
      if (!flow) return;
      const fix = state.data.fixes.find((candidate) => candidate.id === flow.fixId);
      if (!fix) return;
      const check = checkCommitInput({ value: flow.input, fix, suggestion: state.data.suggestion, knownAnalyses: state.data.knownAnalyses });
      set({ commitFlow: { ...flow, check, step: check.ok ? "confirm" : "enter" } });
    },
    backToEdit() {
      if (state.commitFlow) set({ commitFlow: { ...state.commitFlow, step: "enter", check: null } });
    },
    cancelCommit() {
      set({ commitFlow: null });
    },
    /** The ONLY path that sends `applied`: requires the review step to have produced a valid, checked commit. */
    async confirmCommit() {
      const flow = state.commitFlow;
      if (!flow || flow.step !== "confirm" || !flow.check || !flow.check.ok) return;
      const sha = flow.check.commitSha;
      const result = await run("applied", flow.fixId, () => api.applied(flow.fixId, sha));
      if (result.ok) set({ commitFlow: null });
    },

    async verify(fixId: string) {
      await run("verify", fixId, () => api.verify(fixId));
    },
  };
}

export type AssistedFixController = ReturnType<typeof createAssistedFixController>;
