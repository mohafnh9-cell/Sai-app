import type { GenerateResultBody, PanelApi, ApiResult } from "./api";
import { checkCommitInput, errorKeyFor, phaseOf, type CommitCheck, type PanelData, type PanelErrorKey, type PanelFix, type PanelVerification } from "./model";

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
  /** "reloading": a card's state and evidence disagree and fresh data was requested; "failed": it never arrived (say so, offer retry). */
  evidence: "idle" | "reloading" | "failed";
};

/** Keeps whichever of two copies of a record is newer, so an older response can never roll back what the server already told us. */
const at = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0);

export function mergeServerData(local: PanelData, incoming: PanelData): PanelData {
  const localById = new Map(local.fixes.map((fix) => [fix.id, fix]));
  const incomingIds = new Set(incoming.fixes.map((fix) => fix.id));
  const fixes = incoming.fixes.map((fresh) => {
    const known = localById.get(fresh.id);
    if (!known) return fresh;
    const stateFromKnown = at(known.updatedAt) > at(fresh.updatedAt);
    const base = stateFromKnown
      ? { ...fresh, state: known.state, updatedAt: known.updatedAt, reportedCommitSha: known.reportedCommitSha }
      : fresh;
    // Evidence: the newest verification wins; never drop evidence we have for a missing one.
    const verification =
      known.verification && (!fresh.verification || at(known.verification.verifiedAt) > at(fresh.verification.verifiedAt))
        ? known.verification
        : fresh.verification;
    return { ...base, verification };
  });
  // A proposal created a moment ago can be missing from an older server render.
  const localOnly = local.fixes.filter((fix) => !incomingIds.has(fix.id));
  return { ...incoming, fixes: [...localOnly, ...fixes] };
}

export type ControllerOptions = {
  api: PanelApi;
  initial: PanelData;
  /** Asks the host to re-render server data (analyses, verification details) after a state change. */
  onReload?: () => void;
  /** Delays (ms) between attempts to obtain fresh evidence while a card's state and evidence disagree. */
  reloadDelaysMs?: number[];
};

export function createAssistedFixController(options: ControllerOptions) {
  const { api, onReload } = options;
  const reloadDelays = options.reloadDelaysMs ?? [0, 2000, 5000, 10000];
  let state: PanelState = { data: options.initial, busy: null, error: null, notice: null, chooseBlocker: null, commitFlow: null, evidence: "idle" };
  const listeners = new Set<() => void>();

  const set = (patch: Partial<PanelState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const setData = (data: PanelData) => set({ data });

  /** Re-reads the persisted records and merges their state; asks the host for enriched data when something changed. */
  let refreshSeq = 0;
  async function refresh(): Promise<void> {
    const mine = ++refreshSeq;
    const result = await api.list();
    // A response that is not the latest request's is stale (out of order): drop it.
    if (!result.ok || mine !== refreshSeq) return;
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
    ensureEvidence();
  }

  // --- evidence coherence: never wait on one router.refresh() to fix a card that contradicts itself ---------------------
  let evidenceLoop = 0;
  const needsEvidence = () => state.data.fixes.some((fix) => phaseOf(fix) === "updating");

  /** While any card is in "updating", keep asking the host for fresh data (bounded); if it never arrives, say so. */
  function ensureEvidence(): void {
    if (!needsEvidence()) {
      evidenceLoop++;
      if (state.evidence !== "idle") set({ evidence: "idle" });
      return;
    }
    // "failed" is final until the person asks again (Retry): a later refresh() must not silently start another round.
    if (state.evidence === "reloading" || state.evidence === "failed") return;
    const mine = ++evidenceLoop;
    set({ evidence: "reloading" });
    void (async () => {
      for (const delay of reloadDelays) {
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        if (mine !== evidenceLoop) return;
        if (!needsEvidence()) break;
        onReload?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (mine !== evidenceLoop) return;
      // Give the last reload a moment to be adopted before declaring failure.
      await new Promise((resolve) => setTimeout(resolve, reloadDelays.length ? 1500 : 0));
      if (mine !== evidenceLoop) return;
      set({ evidence: needsEvidence() ? "failed" : "idle" });
    })();
  }

  /** Records the verification the verify route just returned, bound to the commit it was made for. */
  function applyVerification(fixId: string, result: { statement: string; outcome?: string; verifiedCommitSha: string | null; details?: Record<string, unknown> }) {
    const fix = state.data.fixes.find((candidate) => candidate.id === fixId);
    if (!fix || (result.outcome !== "passed" && result.outcome !== "failed" && result.outcome !== "partial")) return;
    const details = result.details ?? {};
    const verifiedSha = result.verifiedCommitSha;
    const verification: PanelVerification = {
      statement: result.statement as PanelVerification["statement"],
      outcome: result.outcome,
      verifiedCommitSha: verifiedSha,
      verifiedAnalysis: verifiedSha ? (state.data.knownAnalyses.find((a) => a.commitSha?.toLowerCase() === verifiedSha.toLowerCase()) ?? null) : null,
      reasons: Array.isArray(details.reasons) ? (details.reasons as unknown[]).map(String) : [],
      verifiedAt: new Date().toISOString(),
      commitSha: typeof details.proposalCommitSha === "string" ? details.proposalCommitSha : fix.reportedCommitSha,
    };
    setData({ ...state.data, fixes: state.data.fixes.map((candidate) => (candidate.id === fixId ? { ...candidate, verification } : candidate)) });
  }

  async function run<T>(
    label: string,
    fixId: string | null,
    action: () => Promise<ApiResult<T>>,
    onOk?: (body: T) => void
  ): Promise<ApiResult<T>> {
    set({ busy: label, error: null, notice: null });
    const result = await action();
    if (result.ok) onOk?.(result.body);
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
      setData(mergeServerData(state.data, data));
      ensureEvidence();
    },
    /** Starts/continues the evidence reload when the initial data already contradicts itself (e.g. after a navigation). */
    ensureEvidence,
    retryEvidence() {
      if (state.evidence === "reloading") return;
      evidenceLoop++;
      set({ evidence: "idle" });
      ensureEvidence();
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
      // The route returns the verification it just persisted: show THAT evidence before the re-read, never the previous attempt's.
      await run("verify", fixId, () => api.verify(fixId), (body) => applyVerification(fixId, body.verification));
    },
  };
}

export type AssistedFixController = ReturnType<typeof createAssistedFixController>;
