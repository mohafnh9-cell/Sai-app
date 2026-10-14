import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let lang: "en" | "es" = "en";
const lookup = (ns: string | undefined, key: string, params?: Record<string, unknown>) => {
  const segments = key.split(".");
  const namespace = ns ?? segments.shift()!;
  let node: unknown = JSON.parse(readFileSync(`messages/${lang}/${namespace}.json`, "utf8"));
  for (const part of segments) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${namespace}.${segments.join(".")}`);
  return node.replace(/\{(\w+)\}/g, (_m, k) => String(params?.[k] ?? ""));
};
vi.mock("@/lib/i18n/client", () => ({ useI18n: (ns?: string) => ({ t: (key: string, params?: Record<string, unknown>) => lookup(ns, key, params), locale: lang }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { AssistedFixCard, CommitDialog } from "../components/AssistedFixPanel";
import type { PanelData, PanelFix } from "../model";

// Acceptance of 2026-10-13: the commit form opened at the bottom of the panel with no sign it had opened; after Reabrir the card kept
// showing the failed attempt's commit as "Commit informado"; changing the commit of an approved proposal silently dropped the approval
// and the confirmation then failed with a generic error; "Usar este commit" gave no feedback.

const BASE = "a".repeat(40);
const OLD = "0".repeat(40);
const NEW = "b".repeat(40);
const an = (sha: string) => ({ scanId: "s-" + sha.slice(0, 4), commitSha: sha, branch: "main", completedAt: "2026-10-13T11:12:00.000Z" });
const fix = (state: PanelFix["state"], over: Partial<PanelFix> = {}): PanelFix => ({
  id: "fix-1", recommendationId: "r", title: "Harden authentication", severity: null, state, createdAt: "", updatedAt: "", baseAnalysis: an(BASE),
  reportedCommitSha: null, instructions: "", filesToChange: [], verification: null, ...over,
});
const noop = () => undefined;
const asyncNoop = async () => undefined;
const text = (html: string) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const card = (f: PanelFix, children?: unknown) =>
  renderToStaticMarkup(createElement(AssistedFixCard, { fix: f, controller: { approve: asyncNoop, reopen: asyncNoop, verify: asyncNoop, startCommit: noop }, busy: null, canAct: true, children } as never));
const data = (f: PanelFix, suggestion = true): PanelData => ({ projectId: "p", fixes: [f], knownAnalyses: [an(NEW)], suggestion: suggestion ? { branch: "main", commitSha: NEW, detectedAt: null, analysis: an(NEW) } : null });
const dialogController = { setCommitInput: noop, useSuggestion: noop, reviewCommit: noop, backToEdit: noop, cancelCommit: noop, confirmCommit: asyncNoop };
const dialog = (f: PanelFix, flow: Parameters<typeof CommitDialog>[0]["flow"]) =>
  renderToStaticMarkup(createElement(CommitDialog, { data: data(f), controller: dialogController, flow, busy: null }));

describe("Reabrir is offered only where the server accepts it", () => {
  it.each([["READY", false], ["APPROVED", false], ["APPLIED", false], ["VERIFIED", false], ["FAILED", true]] as const)("%s -> %s", (state, shown) => {
    lang = "en";
    const html = card(fix(state, { reportedCommitSha: NEW, verification: { statement: "exact_commit_rescan_clean", reasons: [] } as never }));
    expect(html.includes(">Reopen<")).toBe(shown); // the button label only, not explanatory text
  });
});

describe.each(["en", "es"] as const)("assisted-fix usability [%s]", (l) => {
  it("a commit left by an earlier attempt is labelled as such (kept, not deleted) and does not read as 'the commit you reported'", () => {
    lang = l;
    for (const state of ["READY", "APPROVED"] as const) {
      const html = card(fix(state, { reportedCommitSha: OLD }));
      expect(html).toContain('data-testid="assisted-fix-previous-commit"');
      expect(html).toContain(`<code>${OLD}</code>`); // the SHA is still shown: nothing was erased
      expect(text(html)).toMatch(l === "en" ? /Previous commit \(not verified\)/ : /Commit anterior \(no verificado\)/);
      expect(text(html)).not.toMatch(l === "en" ? /Reported commit/ : /Commit informado/);
    }
  });

  it("the commit of an APPLIED proposal is still 'the reported commit'", () => {
    lang = l;
    const html = card(fix("APPLIED", { reportedCommitSha: NEW }));
    expect(html).not.toContain("assisted-fix-previous-commit");
    expect(text(html)).toMatch(l === "en" ? /Reported commit/ : /Commit informado/);
  });

  it("the commit form is rendered inside the card it belongs to", () => {
    lang = l;
    const f = fix("APPROVED");
    const inner = renderToStaticMarkup(createElement(CommitDialog, { data: data(f), controller: dialogController, flow: { fixId: "fix-1", input: "", step: "enter", check: null }, busy: null }));
    const html = card(f, createElement("div", { dangerouslySetInnerHTML: { __html: inner } }));
    const li = html.slice(html.indexOf("<li"), html.lastIndexOf("</li>"));
    expect(li).toContain('data-testid="assisted-fix-commit-dialog"');
  });

  it("changing the commit of an APPROVED proposal says, BEFORE confirming, that the approval will be invalidated", () => {
    lang = l;
    const f = fix("APPROVED", { reportedCommitSha: OLD });
    const html = dialog(f, { fixId: "fix-1", input: NEW, step: "confirm", check: { ok: true, commitSha: NEW, analysis: an(NEW), branch: "main", isSuggestion: true } });
    expect(html).toContain('data-testid="assisted-fix-confirm-invalidates"');
    expect(text(html)).toMatch(l === "en" ? /invalidates the approval[^.]*approve the proposal again/ : /invalida la aprobación[^.]*aprobar la propuesta de nuevo/);
    expect(text(html)).toContain("0000000"); // previous
    expect(text(html)).toContain("bbbbbbb"); // new
  });

  it("no warning when nothing is invalidated (no earlier commit, or the same commit)", () => {
    lang = l;
    const check = { ok: true as const, commitSha: NEW, analysis: an(NEW), branch: "main", isSuggestion: true };
    expect(dialog(fix("APPROVED"), { fixId: "fix-1", input: NEW, step: "confirm", check })).not.toContain("assisted-fix-confirm-invalidates");
    expect(dialog(fix("APPROVED", { reportedCommitSha: NEW }), { fixId: "fix-1", input: NEW, step: "confirm", check })).not.toContain("assisted-fix-confirm-invalidates");
  });

  it("'Use this commit' shows it was applied (button disabled, hint) but the field only holds it: nothing is sent", () => {
    lang = l;
    const f = fix("APPROVED");
    const before = dialog(f, { fixId: "fix-1", input: "", step: "enter", check: null });
    expect(before).not.toContain("assisted-fix-suggestion-selected");
    const after = dialog(f, { fixId: "fix-1", input: NEW, step: "enter", check: null });
    expect(after).toContain('data-testid="assisted-fix-suggestion-selected"');
    expect(text(after)).toMatch(l === "en" ? /Commit selected/ : /Commit seleccionado/);
    expect(text(after)).toMatch(l === "en" ? /nothing has been sent/ : /nada se ha enviado/);
  });
});
