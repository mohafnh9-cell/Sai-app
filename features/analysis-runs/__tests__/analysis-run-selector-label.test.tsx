import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/projects/p/mission-control",
  useSearchParams: () => new URLSearchParams(),
}));

type Lang = "en" | "es";
let lang: Lang = "en";
const messages = (l: Lang, ns: string) => JSON.parse(readFileSync(`messages/${l}/${ns}.json`, "utf8")) as Record<string, unknown>;
const lookup = (ns: string, key: string, params?: Record<string, unknown>) => {
  let node: unknown = messages(lang, ns);
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  if (typeof node !== "string") throw new Error(`missing i18n key ${lang}:${ns}.${key}`);
  return node.replace(/\{(\w+)\}/g, (_m, k) => String(params?.[k] ?? ""));
};
vi.mock("@/lib/i18n/client", () => ({
  useI18n: (ns: string) => ({ t: (key: string, params?: Record<string, unknown>) => lookup(ns, key, params) }),
}));

import { AnalysisRunSelector } from "../components/AnalysisRunSelector";
import type { AnalysisRunListItem } from "@/server/analysis-runs/list-analysis-runs";
import { formatAnalysisRunStatusLabel } from "@/lib/i18n/analysis-run-status";

const AFFIRMATIVE = /ready to ship|ready to deploy|listo para desplegar|safe|segura|ship it|puedes desplegar/i;
const NOT_AFFIRMATIVE = /not ready|no listo|evidence limited|evidencia limitada|more analysis|se necesita m[aá]s an[aá]lisis/i;

const run = (over: Partial<AnalysisRunListItem>): AnalysisRunListItem => ({
  runId: "r1", status: "completed", commitSha: "d1e1211abcdef", branch: "main", createdAt: "2026-10-05T00:00:00Z",
  completedAt: "2026-10-05T00:05:00Z", securityScore: 100, verdictStatus: null, deploymentPosture: null, ...over,
});

const optionText = (r: AnalysisRunListItem) => {
  // The selector renders nothing for a single run, so add an unrelated older run and read the first option.
  const older = run({ runId: "r0", commitSha: "0ld0ld0ld0ld", verdictStatus: null, deploymentPosture: null, securityScore: null, status: "failed" });
  const html = renderToStaticMarkup(createElement(AnalysisRunSelector, { runs: [r, older], activeRunId: r.runId }));
  return [...html.matchAll(/<option[^>]*>(.*?)<\/option>/g)][0]?.[1].replace(/<!--.*?-->/g, "") ?? "";
};

describe.each(["en", "es"] as const)("AnalysisRunSelector label [%s]", (l) => {
  lang = l;
  const labelFor = (over: Partial<AnalysisRunListItem>) => { lang = l; return optionText(run(over)); };

  it("A. LOW + incomplete evidence + score 100 + 0 blockers (live E2E case) is never 'ready to deploy'", () => {
    const text = labelFor({ verdictStatus: "ready_to_ship", deploymentPosture: "ready_evidence_limited" });
    expect(text).not.toMatch(AFFIRMATIVE);
    expect(text).toMatch(NOT_AFFIRMATIVE);
    expect(text).toContain("100/100");
  });

  it("B. raw ready_to_ship status alone (no canonical posture) cannot produce deployment language", () => {
    for (const deploymentPosture of [null, "ready_evidence_limited", "more_analysis_required", "not_ready"] as const) {
      expect(labelFor({ verdictStatus: "ready_to_ship", deploymentPosture })).not.toMatch(AFFIRMATIVE);
    }
  });

  it("C. NOT_READY communicates NOT_READY", () => {
    const text = labelFor({ verdictStatus: "not_ready", deploymentPosture: "not_ready", securityScore: 0 });
    expect(text).toMatch(/not ready|no listo/i);
    expect(text).not.toMatch(/^(?!.*not ready|.*no listo).*ready/i);
  });

  it("only a genuinely eligible posture ('ready') may read as ready to deploy", () => {
    expect(labelFor({ verdictStatus: "ready_to_ship", deploymentPosture: "ready" })).toMatch(/ready|listo para desplegar/i);
  });

  it("scan in progress / no final verdict shows the run status, never a decision", () => {
    for (const status of ["running", "queued"]) {
      const text = labelFor({ status, verdictStatus: null, deploymentPosture: null, securityScore: null });
      expect(text).not.toMatch(AFFIRMATIVE);
    }
  });

  it("formatAnalysisRunStatusLabel without the affirms flag never returns the affirmative copy", () => {
    lang = l;
    const t = (k: string) => lookup("missionControl", k);
    const tv = (k: string) => lookup("verdict", k);
    expect(formatAnalysisRunStatusLabel("ready_to_ship", t, tv)).not.toMatch(AFFIRMATIVE);
    expect(formatAnalysisRunStatusLabel("ready_to_ship", t, tv, false)).not.toMatch(AFFIRMATIVE);
  });
});
