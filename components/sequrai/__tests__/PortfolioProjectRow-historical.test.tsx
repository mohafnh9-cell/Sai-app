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
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));

import { PortfolioProjectRow } from "../PortfolioProjectRow";
import type { ProjectBrainSummary } from "@/brain";

const base: ProjectBrainSummary = {
  projectId: "p", projectName: "demo", productionReady: 96, scoreDelta: null, projectedScore: null, blockersCount: 0, healthStatus: null,
  status: "ready_to_ship", lastReviewedCommit: null, generatedAt: null, affirmsDeploy: true, verdictState: "current",
};
const text = (summary: ProjectBrainSummary) =>
  renderToStaticMarkup(createElement(PortfolioProjectRow, { projectId: "p", projectName: "demo", summary }))
    .replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const AFFIRMATIVE = /ready to ship|ready to deploy|listo para desplegar|lista para producci[oó]n/i;

describe.each(["en", "es"] as const)("PortfolioProjectRow: historical vs current [%s]", (l) => {
  it("control: a current affirmed verdict shows its score and the affirmative status", () => {
    lang = l;
    const out = text(base);
    expect(out).toContain("96");
    expect(out).toMatch(AFFIRMATIVE);
    expect(out).not.toMatch(/analysis in progress|an[aá]lisis en curso/i);
  });

  it.each(["historical_review_in_progress", "pending_verdict"] as const)("%s -> in progress + labelled historical; no score, no affirmative status", (verdictState) => {
    lang = l;
    const out = text({ ...base, verdictState, affirmsDeploy: false, productionReady: null });
    expect(out).toMatch(l === "en" ? /Analysis in progress/ : /An[aá]lisis en curso/);
    expect(out).toMatch(l === "en" ? /Previous result \(historical/ : /Resultado anterior \(hist[oó]rico/);
    expect(out).not.toContain("96");
    expect(out).not.toMatch(AFFIRMATIVE);
  });
});
