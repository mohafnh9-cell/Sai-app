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
vi.mock("@/lib/analytics/track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/features/demo/use-demo-navigation", () => ({ useDemoNavigation: () => ({ href: (p: string) => p }) }));
vi.mock("../components/JourneyScoreChart", () => ({ JourneyScoreChart: () => null }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));

import { ProductionJourneyView } from "../components/ProductionJourneyView";
import { journeyOf } from "@/brain/__tests__/fixtures/journey-fixture";

const APPROVAL = /production ready|production maintained|ready to ship|ready to deploy|lista para producci[oó]n|producci[oó]n mantenida|listo para desplegar|lista para desplegar|safe to deploy|ship it/i;
const NEUTRAL = /not ready to ship|not ready|no listo|ready to ship\?/gi;

function render(kinds: Parameters<typeof journeyOf>[0], reviewInProgress = false) {
  const html = renderToStaticMarkup(createElement(ProductionJourneyView, { journey: journeyOf(kinds), projectId: "p", reviewInProgress }));
  return html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

describe.each(["en", "es"] as const)("ProductionJourneyView renders the canonical posture only [%s]", (l) => {
  const text = (kinds: Parameters<typeof journeyOf>[0], inProgress = false) => { lang = l; return render(kinds, inProgress); };

  it("LOW + incomplete evidence: no approval wording anywhere on the page", () => {
    const t = text(["ready_low_incomplete", "ready_low_incomplete", "ready_low_incomplete"]).replace(NEUTRAL, " ");
    expect(t).not.toMatch(APPROVAL);
  });

  it("NOT_READY: the posture row says not ready", () => {
    expect(text(["not_ready"])).toMatch(/not ready to deploy|no listo para desplegar/i);
  });

  it("active scan: the CURRENT maturity and posture say analysis in progress, never the previous (even READY) state", () => {
    lang = l;
    const html = renderToStaticMarkup(createElement(ProductionJourneyView, { journey: journeyOf(["ready_full", "ready_full"]), projectId: "p", reviewInProgress: true })).replace(/<!--.*?-->/g, "");
    const cells = [...html.matchAll(/<p class="text-sm font-medium mt-1"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(cells.filter((c) => /analysis in progress|an[aá]lisis en curso/i.test(c))).toHaveLength(2); // maturity + posture
    expect(cells.join(" | ")).not.toMatch(APPROVAL);
    // past milestones remain as history; they are not the current decision
  });

  it("genuinely READY keeps its approval wording", () => {
    expect(text(["ready_full", "ready_full"])).toMatch(/production maintained|producci[oó]n mantenida/i);
  });
});
