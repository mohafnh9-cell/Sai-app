import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { detectLocaleFromAcceptLanguage, resolveLocalePreference } from "@/lib/i18n/detect";
import { loadNamespace } from "@/lib/i18n/load-messages";
import { formatRelativeLocalized } from "@/lib/i18n/format";
import { verdictStatusLabel } from "@/lib/i18n/verdict-copy";

describe("Block 6.4.1 i18n foundation", () => {
  it("detects Spanish from browser locale", () => {
    expect(detectLocaleFromAcceptLanguage("es-ES,es;q=0.9")).toBe("es");
    expect(detectLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(detectLocaleFromAcceptLanguage(null)).toBe("en");
  });

  it("prefers saved profile locale over browser", () => {
    expect(resolveLocalePreference("es", "en", "en-US")).toBe("es");
    expect(resolveLocalePreference(null, "es", "en-US")).toBe("es");
  });

  it("falls back to English for unknown locale", () => {
    expect(resolveLocalePreference("fr", null, null)).toBe("en");
  });

  it("translates plurals in English and Spanish", () => {
    const en = createTranslator({ verdict: loadNamespace("en", "verdict") }, "en");
    const es = createTranslator({ verdict: loadNamespace("es", "verdict") }, "es");

    expect(en("verdict.productionBlocker", { count: 1 })).toContain("1");
    expect(en("verdict.productionBlocker", { count: 3 })).toContain("blockers");
    expect(es("verdict.productionBlocker", { count: 3 })).toContain("bloqueadores");
  });

  it("keeps brand product names in Spanish verdict labels", () => {
    const es = createTranslator({ verdict: loadNamespace("es", "verdict") }, "es");
    expect(verdictStatusLabel("not_ready", (key) => es(key))).toContain("producción");
  });

  it("loads onboarding progress keys", () => {
    const onboarding = loadNamespace("es", "onboarding");
    expect(onboarding.progress).toBeTruthy();
    expect((onboarding.progress as Record<string, string>).github).toContain("GitHub");
  });

  it("formats relative dates in Spanish", () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeLocalized("es", twoHoursAgo, {
      never: "Nunca",
      justNow: "Ahora mismo",
      minutesAgo: "hace {count} min",
      hoursAgo: "hace {count} h",
      daysAgo: "hace {count} d",
    });
    expect(result).toContain("hace");
    expect(result).toContain("2");
  });

  it("returns key when translation is missing", () => {
    const t = createTranslator({}, "en");
    expect(t("missing.key")).toBe("missing.key");
  });

  it("loads productionJourney namespace in English and Spanish", () => {
    const en = loadNamespace("en", "productionJourney");
    const es = loadNamespace("es", "productionJourney");

    expect(en.title).toBe("History");
    expect(es.title).toBe("History");
    expect((en.trendValues as Record<string, string>).improving).toBe("Improving");
    expect((es.trendValues as Record<string, string>).improving).toBe("Mejorando");
    expect((es.maturityValues as Record<string, string>).production_ready).toBe("Lista para producción");
  });
});
