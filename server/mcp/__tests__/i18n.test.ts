import { describe, expect, it } from "vitest";
import { getMcpTranslator, resolveMcpLocale } from "@/server/mcp/i18n";
import { createFakeAdmin } from "./fake-admin";

describe("resolveMcpLocale", () => {
  it("prefers an explicit locale over the profile locale", async () => {
    const admin = createFakeAdmin({ profiles: [{ id: "user-1", locale: "es" }] });
    const locale = await resolveMcpLocale(admin as never, "user-1", "en");
    expect(locale).toBe("en");
  });

  it("falls back to the API key owner's profile locale", async () => {
    const admin = createFakeAdmin({ profiles: [{ id: "user-1", locale: "es" }] });
    const locale = await resolveMcpLocale(admin as never, "user-1", undefined);
    expect(locale).toBe("es");
  });

  it("falls back to English when no explicit locale or profile locale exists", async () => {
    const admin = createFakeAdmin({ profiles: [] });
    const locale = await resolveMcpLocale(admin as never, "user-1", undefined);
    expect(locale).toBe("en");
  });

  it("ignores an invalid explicit locale", async () => {
    const admin = createFakeAdmin({ profiles: [{ id: "user-1", locale: "es" }] });
    const locale = await resolveMcpLocale(admin as never, "user-1", "fr");
    expect(locale).toBe("es");
  });
});

describe("getMcpTranslator", () => {
  it("returns English copy for the en locale", () => {
    const t = getMcpTranslator("en");
    expect(t("header")).toBe("SEQURAI");
    expect(t("modes.production_review")).toBe("DEPLOY ANSWER");
  });

  it("returns Spanish copy for the es locale", () => {
    const t = getMcpTranslator("es");
    expect(t("header")).toBe("SEQURAI");
    expect(t("modes.production_review")).toBe("RESPUESTA DE DESPLIEGUE");
  });

  it("interpolates params in error messages", () => {
    const t = getMcpTranslator("en");
    expect(t("canIDeploy.staleWarning", { commitSha: "abc1234" })).toContain("abc1234");
  });

  it("has EN and ES copy for unknown freshness and failed-review warnings", () => {
    const en = getMcpTranslator("en");
    const es = getMcpTranslator("es");

    expect(en("canIDeploy.freshnessUnknown")).toContain("couldn't verify");
    expect(es("canIDeploy.freshnessUnknown")).toContain("No pude verificar");
    expect(en("canIDeploy.reviewFailedWarning")).toContain("didn't finish");
    expect(es("canIDeploy.reviewFailedWarning")).toContain("no terminó");
  });

  it("has EN and ES copy for review_now (production review request)", () => {
    const en = getMcpTranslator("en");
    const es = getMcpTranslator("es");

    expect(en("modes.production_review_request")).toBe("STARTING PROTECTION REVIEW");
    expect(es("modes.production_review_request")).toBe("INICIANDO REVISIÓN DE PROTECCIÓN");
    expect(en("reviewNow.queuedNext")).toContain("Can I deploy");
    expect(es("reviewNow.queuedNext")).toContain("desplegar");
  });

  it("has EN and ES copy for review_now's new error codes", () => {
    const en = getMcpTranslator("en");
    const es = getMcpTranslator("es");

    for (const code of ["invalid_commit", "commit_not_found", "review_creation_failed", "repository_too_large"]) {
      expect(en(`errors.${code}`)).toBeTruthy();
      expect(es(`errors.${code}`)).toBeTruthy();
      expect(en(`errors.${code}`)).not.toBe(es(`errors.${code}`));
    }
  });
});
