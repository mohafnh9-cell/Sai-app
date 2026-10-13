import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let lang: "en" | "es" = "en";
const messages = (ns: string) => JSON.parse(readFileSync(`messages/${lang}/${ns}.json`, "utf8")) as Record<string, unknown>;
const lookup = (ns: string | undefined, key: string, params?: Record<string, unknown>) => {
  const segments = key.split(".");
  const namespace = ns ?? segments.shift()!;
  let node: unknown = messages(namespace);
  for (const part of segments) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${namespace}.${segments.join(".")}`);
  return node.replace(/\{(\w+)\}/g, (_m, k) => String(params?.[k] ?? ""));
};
vi.mock("@/lib/i18n/client", () => ({
  useI18n: (ns?: string) => ({ t: (key: string, params?: Record<string, unknown>) => lookup(ns, key, params), locale: lang }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { AssistedFixCard, AssistedFixPanel, CommitDialog } from "../components/AssistedFixPanel";
import type { PanelData, PanelFix } from "../model";

const BASE = "a".repeat(40);
const FIX = "b".repeat(40);
const analysis = (sha: string) => ({ scanId: "scan-" + sha.slice(0, 4), commitSha: sha, branch: "main", completedAt: "2026-10-09T10:00:00.000Z" });
const fix = (state: PanelFix["state"], over: Partial<PanelFix> = {}): PanelFix => ({
  id: "fix-1", recommendationId: "priority-1", title: "Harden authentication", severity: null, state, createdAt: "", updatedAt: "",
  baseAnalysis: analysis(BASE), reportedCommitSha: null, instructions: "PROMPT BODY", filesToChange: ["src/auth.ts"], verification: null, ...over,
});
const exact = { statement: "exact_commit_rescan_clean" as const, outcome: "passed" as const, verifiedCommitSha: FIX, verifiedAnalysis: analysis(FIX), reasons: [], verifiedAt: "" };
const noop = () => undefined;
const asyncNoop = async () => undefined;
const controller = { approve: asyncNoop, reopen: asyncNoop, verify: asyncNoop, startCommit: noop };

const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const card = (f: PanelFix, busy: string | null = null, canAct = true) =>
  renderToStaticMarkup(createElement(AssistedFixCard, { fix: f, controller, busy, canAct }));

const VERIFIED_BADGE = { en: /Verified in the commit/, es: /Verificado en el commit/ };

describe.each(["en", "es"] as const)("every phase is rendered for what it is [%s]", (l) => {
  const render = (f: PanelFix, busy: string | null = null, canAct = true) => { lang = l; return card(f, busy, canAct); };

  it("proposal: documentary, nothing changed, no verified-correction wording, only Approve", () => {
    for (const state of ["PROPOSED", "READY"] as const) {
      const html = render(fix(state));
      expect(html).toContain('data-phase="proposal"');
      expect(text(html)).not.toMatch(VERIFIED_BADGE[l]);
      expect(text(html)).toMatch(l === "en" ? /has not changed your code/ : /no ha cambiado tu código/);
      expect(html).toContain("PROMPT BODY");
    }
    expect(text(render(fix("READY")))).toMatch(l === "en" ? /Approve proposal/ : /Aprobar propuesta/);
    expect(text(render(fix("READY")))).not.toMatch(l === "en" ? /Report the correction commit|Verify/ : /Informar el commit|Verificar/);
  });

  it("base analysis (branch, commit, date) is always shown", () => {
    const html = text(render(fix("READY")));
    expect(html).toContain("main");
    expect(html).toContain("aaaaaaa");
  });

  it("approved: asks for the commit, still not a correction", () => {
    const html = render(fix("APPROVED"));
    expect(html).toContain('data-phase="approved"');
    expect(text(html)).toMatch(l === "en" ? /Report the correction commit/ : /Informar el commit de la corrección/);
    expect(text(html)).not.toMatch(VERIFIED_BADGE[l]);
  });

  it("applied: commit reported, pending verification, offers Verify, not a correction", () => {
    const html = render(fix("APPLIED", { reportedCommitSha: FIX }));
    expect(html).toContain('data-phase="applied"');
    expect(text(html)).toContain(FIX);
    expect(text(html)).toMatch(l === "en" ? /nothing has been verified yet/ : /todavía no se ha verificado nada/);
    expect(text(html)).not.toMatch(VERIFIED_BADGE[l]);
    expect(text(html)).toMatch(l === "en" ? /Verify/ : /Verificar/);
  });

  it("verifying: no actions, says the page updates itself", () => {
    const html = render(fix("VERIFYING", { reportedCommitSha: FIX }));
    expect(html).toContain('data-phase="verifying"');
    expect(text(html)).not.toMatch(VERIFIED_BADGE[l]);
  });

  it("verified (exact commit): shows the FULL commit, the analysis and the exact-commit statement", () => {
    const html = render(fix("VERIFIED", { reportedCommitSha: FIX, verification: exact }));
    expect(html).toContain('data-phase="verified"');
    expect(text(html)).toMatch(VERIFIED_BADGE[l]);
    expect(html).toContain(`<code>${FIX}</code>`);
    expect(text(html)).toMatch(l === "en" ? /exactly that commit/ : /exactamente ese commit/);
    expect(text(html)).toContain("bbbbbbb");
  });

  it.each([
    ["VERIFIED but only a later unbound analysis", fix("VERIFIED", { verification: { ...exact, statement: "later_analysis_clean_unbound" as const } })],
    ["FAILED", fix("FAILED", { verification: { ...exact, statement: "not_verified" as const, outcome: "failed" as const, reasons: ["target_still_present"] } })],
    ["VERIFIED without a readable verification", fix("VERIFIED")],
  ])("%s is NEVER shown as a verified correction", (_name, f) => {
    const html = render(f);
    expect(html).toContain('data-phase="not_verified"');
    expect(text(html)).not.toMatch(VERIFIED_BADGE[l]);
    expect(text(html)).toMatch(l === "en" ? /Not verified/ : /No verificada/);
  });

  it("historical: marked as such and without actions", () => {
    const html = render(fix("SUPERSEDED"), null, false);
    expect(html).toContain('data-phase="historical"');
    expect(text(html)).not.toMatch(l === "en" ? /Approve proposal|Verify/ : /Aprobar propuesta|Verificar/);
  });

  it("actions are disabled while another operation is running", () => {
    expect(render(fix("READY"), "approve")).toContain("disabled");
  });
});

const data = (over: Partial<PanelData> = {}): PanelData => ({
  projectId: "p1", fixes: [fix("APPROVED")], knownAnalyses: [analysis(FIX)],
  suggestion: { branch: "main", commitSha: FIX, detectedAt: "2026-10-09T10:00:00.000Z", analysis: analysis(FIX) }, ...over,
});
const dialogController = { setCommitInput: noop, useSuggestion: noop, reviewCommit: noop, backToEdit: noop, cancelCommit: noop, confirmCommit: asyncNoop };

describe.each(["en", "es"] as const)("reporting the commit never preselects [%s]", (l) => {
  const dialog = (flow: Parameters<typeof CommitDialog>[0]["flow"], d = data()) => { lang = l; return renderToStaticMarkup(createElement(CommitDialog, { data: d, controller: dialogController, flow, busy: null })); };

  it("the field is empty even though a suggestion exists; the suggestion is labelled and is not selected", () => {
    const html = dialog({ fixId: "fix-1", input: "", step: "enter", check: null });
    expect(html).toMatch(/id="assisted-fix-commit-input"[^>]*value=""/);
    expect(html).toContain('data-testid="assisted-fix-suggestion"');
    expect(text(html)).toContain(FIX); // full SHA of the suggestion
    expect(text(html)).toMatch(l === "en" ? /only a suggestion/ : /solo una sugerencia/);
    expect(text(html)).toMatch(l === "en" ? /Use this commit/ : /Usar este commit/);
  });

  it("shows why an input was refused", () => {
    const html = dialog({ fixId: "fix-1", input: "abc", step: "enter", check: { ok: false, reason: "not_full_sha" } });
    expect(html).toContain('role="alert"');
    expect(text(html)).toMatch(l === "en" ? /exactly 40 hexadecimal/ : /exactamente 40 caracteres/);
  });

  it("confirmation shows branch, FULL sha, the commit's analysis and the base analysis, and states what is being declared", () => {
    const html = dialog({ fixId: "fix-1", input: FIX, step: "confirm", check: { ok: true, commitSha: FIX, analysis: analysis(FIX), branch: "main", isSuggestion: true } });
    const t = text(html);
    expect(html).toContain('data-step="confirm"');
    expect(t).toContain("main");
    expect(t).toContain(FIX);
    expect(t).toContain("aaaaaaa"); // base analysis commit
    expect(t).toContain("bbbbbbb"); // commit's analysis
    expect(t).toMatch(l === "en" ? /You are declaring that commit bbbbbbb contains the correction for/ : /Vas a declarar que el commit bbbbbbb contiene la corrección de/);
    expect(t).toMatch(l === "en" ? /until then it is not verified/ : /hasta entonces no está verificado/);
    expect(t).toMatch(l === "en" ? /Confirm commit/ : /Confirmar commit/);
  });

  it("a commit without analysis is flagged in the confirmation", () => {
    const html = dialog({ fixId: "fix-1", input: "d".repeat(40), step: "confirm", check: { ok: true, commitSha: "d".repeat(40), analysis: null, branch: null, isSuggestion: false } });
    expect(text(html)).toMatch(l === "en" ? /no analysis of this commit yet/ : /Aún no hay análisis de este commit/);
  });
});

describe.each(["en", "es"] as const)("the panel as a whole [%s]", (l) => {
  it("renders the section, the Generate button and the live corrections; history is collapsed", () => {
    lang = l;
    const html = renderToStaticMarkup(createElement(AssistedFixPanel, { data: data({ fixes: [fix("READY"), fix("SUPERSEDED", { id: "old" })] }) }));
    expect(html).toContain('data-testid="assisted-fix-panel"');
    expect(text(html)).toMatch(l === "en" ? /Generate proposal/ : /Generar propuesta/);
    expect(html.match(/data-testid="assisted-fix-card"/g)).toHaveLength(2); // one live + one in the history list
    expect(html).toContain("<details");
  });

  it("empty project: says so", () => {
    lang = l;
    const html = renderToStaticMarkup(createElement(AssistedFixPanel, { data: data({ fixes: [] }) }));
    expect(text(html)).toMatch(l === "en" ? /no proposals for this project yet/ : /no hay propuestas para este proyecto/);
  });
});
