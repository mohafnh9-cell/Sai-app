"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { formatStableDateTime } from "@/lib/format/stable-date";
import { createPanelApi, type PanelApi } from "../api";
import { createAssistedFixController, type AssistedFixController } from "../controller";
import { phaseOf, shortSha, type PanelAnalysis, type PanelData, type PanelFix, type PanelPhase } from "../model";

const POLL_MS = 4000;

// Stable (UTC) text: the panel is server-rendered and hydrated, so it must not format with the runtime's locale/time zone.
const formatDate = formatStableDateTime;

function AnalysisLine({ analysis, label }: { analysis: PanelAnalysis | null; label: string }) {
  const { t } = useI18n("missionControl");
  return (
    <p className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{label}</span>{" "}
      {analysis
        ? t("assistedFix.analysisLine", {
            branch: analysis.branch ?? t("assistedFix.unknownBranch"),
            sha: shortSha(analysis.commitSha),
            date: formatDate(analysis.completedAt),
          })
        : t("assistedFix.analysisNone")}
    </p>
  );
}

const PHASE_STYLE: Record<PanelPhase, string> = {
  proposal: "border-border bg-muted/40 text-foreground",
  approved: "border-border bg-muted/40 text-foreground",
  applied: "border-amber-500/40 bg-amber-500/10 text-foreground",
  verifying: "border-amber-500/40 bg-amber-500/10 text-foreground",
  verified: "border-emerald-500/40 bg-emerald-500/10 text-foreground",
  not_verified: "border-amber-500/40 bg-amber-500/10 text-foreground",
  updating: "border-border bg-muted/40 text-foreground",
  historical: "border-border bg-transparent text-muted-foreground",
};

export type AssistedFixViewProps = {
  fix: PanelFix;
  controller: Pick<AssistedFixController, "approve" | "reopen" | "verify" | "startCommit">;
  busy: string | null;
  canAct: boolean;
  /** The evidence could not be refreshed in time: say so and offer a retry instead of an endless spinner. */
  evidenceFailed?: boolean;
  onRetryEvidence?: () => void;
  /** The commit form is rendered INSIDE the card it belongs to. */
  children?: ReactNode;
};

/** One correction, rendered for its phase. Static (no hooks beyond i18n) so every phase is testable by markup. */
export function AssistedFixCard({ fix, controller, busy, canAct, evidenceFailed = false, onRetryEvidence, children }: AssistedFixViewProps) {
  const { t } = useI18n("missionControl");
  const phase = phaseOf(fix);
  const disabled = busy !== null || !canAct;
  // A commit stored on a proposal that is not (or no longer) in the "commit reported" step is the PREVIOUS attempt's: it is kept
  // (audit trail, and the server's rules compare against it) but must not read as "the commit you reported".
  const previousCommit = Boolean(fix.reportedCommitSha) && (phase === "proposal" || phase === "approved");

  return (
    <li className={`rounded-lg border p-4 ${PHASE_STYLE[phase]}`} data-testid="assisted-fix-card" data-phase={phase}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{fix.title}</p>
        <span className="rounded-full border px-2 py-0.5 text-xs" data-testid="assisted-fix-phase">
          {t(`assistedFix.phase.${phase}`)}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        <AnalysisLine analysis={fix.baseAnalysis} label={t("assistedFix.baseAnalysis")} />
        {fix.reportedCommitSha && (
          <p className="text-xs text-muted-foreground" data-testid={previousCommit ? "assisted-fix-previous-commit" : undefined}>
            <span className="font-medium text-foreground">{previousCommit ? t("assistedFix.previousCommit") : t("assistedFix.reportedCommit")}</span>{" "}
            <code>{fix.reportedCommitSha}</code>
          </p>
        )}
      </div>

      <p className="mt-3 text-sm" data-testid="assisted-fix-note" role={phase === "updating" ? "status" : undefined}>
        {phase === "updating" && evidenceFailed
          ? t("assistedFix.evidenceFailed")
          : previousCommit
            ? t(`assistedFix.notePrevious.${phase}`)
            : t(`assistedFix.note.${phase}`)}
      </p>
      {phase === "updating" && evidenceFailed && onRetryEvidence && (
        <button type="button" className="mt-2 rounded-md border px-3 py-1.5 text-sm font-medium" onClick={onRetryEvidence}>
          {t("assistedFix.retryEvidence")}
        </button>
      )}

      {phase === "proposal" || phase === "approved" ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-primary">{t("assistedFix.instructions")}</summary>
          {fix.filesToChange.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("assistedFix.files")}: {fix.filesToChange.join(", ")}
            </p>
          )}
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/60 p-3 text-xs">{fix.instructions}</pre>
        </details>
      ) : null}

      {phase === "verified" && fix.verification && (
        <div className="mt-3 space-y-1 text-xs" data-testid="assisted-fix-verified">
          <p>
            <span className="font-medium">{t("assistedFix.verifiedCommit")}</span> <code>{fix.verification.verifiedCommitSha ?? "—"}</code>
          </p>
          <AnalysisLine analysis={fix.verification.verifiedAnalysis} label={t("assistedFix.verifiedAnalysis")} />
          <p className="text-muted-foreground">{t("assistedFix.statement.exact_commit_rescan_clean")}</p>
        </div>
      )}

      {phase === "not_verified" && fix.verification && (
        <div className="mt-3 space-y-1 text-xs" data-testid="assisted-fix-not-verified">
          <p className="text-muted-foreground">{t(`assistedFix.statement.${fix.verification.statement}`)}</p>
          {fix.verification.reasons.length > 0 && (
            <p className="text-muted-foreground">
              {t("assistedFix.technicalReasons")}: <code>{fix.verification.reasons.join(", ")}</code>
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {phase === "proposal" && (
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50" disabled={disabled} onClick={() => void controller.approve(fix.id)}>
            {t("assistedFix.approve")}
          </button>
        )}
        {phase === "approved" && (
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50" disabled={disabled} onClick={() => controller.startCommit(fix.id)}>
            {t("assistedFix.reportCommit")}
          </button>
        )}
        {phase === "applied" && (
          <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50" disabled={disabled} onClick={() => void controller.verify(fix.id)}>
            {busy === "verify" ? t("assistedFix.verifying") : t("assistedFix.verify")}
          </button>
        )}
        {/* The server only reopens a FAILED record (lifecycle.ts, reopenSafeFix); any other state answers invalid_transition. */}
        {fix.state === "FAILED" && (
          <button type="button" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground underline disabled:opacity-50" disabled={disabled} onClick={() => void controller.reopen(fix.id)}>
            {t("assistedFix.reopen")}
          </button>
        )}
      </div>
      {children}
    </li>
  );
}

export type CommitDialogProps = {
  data: PanelData;
  controller: Pick<AssistedFixController, "setCommitInput" | "useSuggestion" | "reviewCommit" | "backToEdit" | "cancelCommit" | "confirmCommit">;
  flow: NonNullable<ReturnType<AssistedFixController["getState"]>["commitFlow"]>;
  busy: string | null;
};

/** Reporting the commit: empty field, optional suggestion card (never selected), explicit confirmation of sha, branch and analysis. */
export function CommitDialog({ data, controller, flow, busy }: CommitDialogProps) {
  const { t } = useI18n("missionControl");
  const fix = data.fixes.find((candidate) => candidate.id === flow.fixId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // Opening the form moves the person to it: scroll it into view and put the focus in the field (keyboard and screen readers too).
  useEffect(() => {
    dialogRef.current?.scrollIntoView?.({ block: "nearest" });
    inputRef.current?.focus();
  }, []);
  const suggestionSelected =
    Boolean(data.suggestion) && flow.input.trim().toLowerCase() === data.suggestion?.commitSha.toLowerCase();
  const suggestion = data.suggestion;
  const check = flow.check;
  const errorReason = check && !check.ok ? check.reason : null;
  // The server drops the approval when the reported commit of an APPROVED proposal changes: say so BEFORE the person confirms.
  const invalidatesApproval =
    flow.step === "confirm" && check?.ok === true && fix?.state === "APPROVED" && Boolean(fix.reportedCommitSha) &&
    (fix.reportedCommitSha as string).toLowerCase() !== check.commitSha.toLowerCase();

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="assisted-fix-commit-title" className="mt-4 rounded-lg border bg-background p-4" data-testid="assisted-fix-commit-dialog" data-step={flow.step}>
      <h4 id="assisted-fix-commit-title" className="text-sm font-semibold">
        {t("assistedFix.commit.title")}
      </h4>

      {flow.step === "enter" && (
        <div className="mt-3 space-y-3">
          <label className="block text-xs font-medium" htmlFor="assisted-fix-commit-input">
            {t("assistedFix.commit.label")}
          </label>
          <input
            id="assisted-fix-commit-input"
            ref={inputRef}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
            value={flow.input}
            placeholder={t("assistedFix.commit.placeholder")}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => controller.setCommitInput(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("assistedFix.commit.help")}</p>
          {errorReason && (
            <p role="alert" className="text-xs text-destructive" data-testid="assisted-fix-commit-error">
              {t(`assistedFix.commit.errors.${errorReason}`)}
            </p>
          )}

          {suggestion && (
            <div className="rounded-md border border-dashed p-3 text-xs" data-testid="assisted-fix-suggestion">
              <p className="font-medium">{t("assistedFix.suggestion.title")}</p>
              <p className="mt-1">
                {t("assistedFix.suggestion.branch")}: <strong>{suggestion.branch ?? t("assistedFix.unknownBranch")}</strong>
              </p>
              <p>
                SHA: <code className="break-all">{suggestion.commitSha}</code>
              </p>
              <AnalysisLine analysis={suggestion.analysis} label={t("assistedFix.suggestion.analysis")} />
              <p className="mt-1 text-muted-foreground">{t("assistedFix.suggestion.notice")}</p>
              <button type="button" className="mt-2 rounded-md border px-2 py-1 disabled:opacity-60" disabled={suggestionSelected} onClick={() => controller.useSuggestion()}>
                {suggestionSelected ? t("assistedFix.suggestion.selected") : t("assistedFix.suggestion.use")}
              </button>
              {suggestionSelected && (
                <p role="status" className="mt-1 text-muted-foreground" data-testid="assisted-fix-suggestion-selected">
                  {t("assistedFix.suggestion.selectedHint")}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium" onClick={() => controller.reviewCommit()}>
              {t("assistedFix.commit.review")}
            </button>
            <button type="button" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground underline" onClick={() => controller.cancelCommit()}>
              {t("assistedFix.commit.cancel")}
            </button>
          </div>
        </div>
      )}

      {flow.step === "confirm" && check && check.ok && (
        <div className="mt-3 space-y-2 text-xs" data-testid="assisted-fix-confirm">
          <p>
            {t("assistedFix.confirm.branch")}: <strong>{check.branch ?? t("assistedFix.confirm.branchUnknown")}</strong>
          </p>
          <p>
            {t("assistedFix.confirm.sha")}: <code className="break-all">{check.commitSha}</code>
          </p>
          <AnalysisLine analysis={check.analysis} label={t("assistedFix.confirm.commitAnalysis")} />
          {!check.analysis && <p className="text-muted-foreground">{t("assistedFix.confirm.noAnalysisWarning")}</p>}
          <AnalysisLine analysis={fix?.baseAnalysis ?? null} label={t("assistedFix.confirm.baseAnalysis")} />
          {invalidatesApproval && (
            <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2" data-testid="assisted-fix-confirm-invalidates">
              {t("assistedFix.confirm.invalidatesApproval", { previous: shortSha(fix?.reportedCommitSha ?? ""), sha: shortSha(check.commitSha) })}
            </p>
          )}
          <p className="font-medium" data-testid="assisted-fix-confirm-statement">
            {t("assistedFix.confirm.statement", { sha: shortSha(check.commitSha), title: fix?.title ?? "" })}
          </p>
          <div className="flex gap-2">
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50" disabled={busy !== null} onClick={() => void controller.confirmCommit()}>
              {t("assistedFix.confirm.button")}
            </button>
            <button type="button" className="rounded-md px-3 py-1.5 text-sm text-muted-foreground underline" onClick={() => controller.backToEdit()}>
              {t("assistedFix.confirm.back")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AssistedFixPanel({ data, api: injectedApi }: { data: PanelData; api?: PanelApi }) {
  const { t } = useI18n("missionControl");
  const router = useRouter();
  const controller = useMemo(
    () =>
      createAssistedFixController({
        api: injectedApi ?? createPanelApi(data.projectId),
        initial: data,
        onReload: () => router.refresh(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.projectId]
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);

  // Server data (analyses, verification details) changes with router.refresh(): adopt it, but never roll back a state the
  // server just told us about with older props.
  useEffect(() => {
    controller.adopt(data);
  }, [data, controller]);

  // A card whose state and evidence disagree (e.g. loaded mid-verification) must not wait on a single router.refresh().
  useEffect(() => {
    controller.ensureEvidence();
  }, [controller]);

  const verifying = state.data.fixes.some((fix) => fix.state === "VERIFYING");
  useEffect(() => {
    if (!verifying) return;
    const timer = window.setInterval(() => void controller.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [verifying, controller]);

  const live = state.data.fixes.filter((fix) => phaseOf(fix) !== "historical");
  const historical = state.data.fixes.filter((fix) => phaseOf(fix) === "historical");

  return (
    <section aria-labelledby="assisted-fix-heading" className="mt-10 rounded-xl border p-5" data-testid="assisted-fix-panel">
      <h2 id="assisted-fix-heading" className="text-lg font-semibold">
        {t("assistedFix.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("assistedFix.intro")}</p>

      <div className="mt-4">
        <button type="button" className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50" disabled={state.busy !== null} onClick={() => void controller.generate()}>
          {state.busy === "generate" ? t("assistedFix.generating") : t("assistedFix.generate")}
        </button>
      </div>

      <div aria-live="polite" className="mt-3 space-y-2">
        {state.notice && <p className="text-sm" data-testid="assisted-fix-notice">{t(`assistedFix.notice.${state.notice}`)}</p>}
        {state.error && (
          <p role="alert" className="text-sm text-destructive" data-testid="assisted-fix-error" data-error={state.error.key}>
            {t(`assistedFix.errors.${state.error.key}`)}
          </p>
        )}
      </div>

      {state.chooseBlocker && (
        <div className="mt-3 rounded-md border p-3" data-testid="assisted-fix-choose">
          <p className="text-sm font-medium">{t("assistedFix.choose.title")}</p>
          <ul className="mt-2 space-y-1">
            {state.chooseBlocker.map((blocker) => (
              <li key={blocker.id}>
                <button type="button" className="text-left text-sm underline" onClick={() => void controller.generate(blocker.id)}>
                  {blocker.title} <span className="text-xs text-muted-foreground">({blocker.severity})</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mt-2 text-xs text-muted-foreground underline" onClick={() => controller.cancelChoice()}>
            {t("assistedFix.choose.cancel")}
          </button>
        </div>
      )}

      {live.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("assistedFix.empty")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {live.map((fix) => (
            <AssistedFixCard key={fix.id} fix={fix} controller={controller} busy={state.busy} canAct evidenceFailed={state.evidence === "failed"} onRetryEvidence={() => controller.retryEvidence()}>
              {state.commitFlow?.fixId === fix.id && <CommitDialog data={state.data} controller={controller} flow={state.commitFlow} busy={state.busy} />}
            </AssistedFixCard>
          ))}
        </ul>
      )}

      {historical.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-muted-foreground">{t("assistedFix.history", { count: historical.length })}</summary>
          <ul className="mt-2 space-y-2">
            {historical.map((fix) => (
              <AssistedFixCard key={fix.id} fix={fix} controller={controller} busy={state.busy} canAct={false} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
