"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/client";
import { MCP_LOCAL_TOOLS, MCP_REMOTE_TOOLS } from "@/content/landing";

export function McpPageBody({ isAuthenticated }: { isAuthenticated: boolean }) {
  const { t } = useI18n("landing");

  return (
    <>
      <section className="mx-auto max-w-[820px] px-6 pb-20 text-center">
        <p className="text-[11px] uppercase tracking-[0.28em] text-text-muted">{t("mcpPage.eyebrow")}</p>
        <h1 className="mt-6 text-[clamp(2rem,5vw,3rem)] font-semibold leading-[1.08] tracking-[-0.04em]">
          {t("mcpPage.title")}
        </h1>
        <p className="mx-auto mt-6 max-w-[620px] text-[15px] leading-relaxed text-muted-foreground">
          {t("mcpPage.intro")}
        </p>
      </section>

      <section className="border-t border-border bg-background py-20 md:py-24">
        <div className="mx-auto grid max-w-[1200px] gap-16 px-6 md:grid-cols-2">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("mcpPage.whyTitle")}</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{t("mcpPage.whyBody")}</p>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("mcpPage.authTitle")}</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{t("mcpPage.authBody")}</p>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background-deep py-20 md:py-24">
        <div className="mx-auto max-w-[1200px] px-6">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("mcpPage.capabilitiesTitle")}</h2>

          <div className="mt-10 grid gap-10 lg:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">{t("mcpPage.capabilitiesRemoteIntro")}</p>
              <dl className="mt-6 space-y-5">
                {MCP_REMOTE_TOOLS.map((tool) => (
                  <div key={tool} className="border-l border-border pl-4">
                    <dt className="font-mono text-[13px] text-foreground">{tool}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t(`mcpPage.toolDescriptions.${tool}`)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("mcpPage.capabilitiesLocalIntro")}</p>
              <dl className="mt-6 space-y-5">
                {MCP_LOCAL_TOOLS.map((tool) => (
                  <div key={tool} className="border-l border-border pl-4">
                    <dt className="font-mono text-[13px] text-foreground">{tool}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {t(`mcpPage.toolDescriptions.${tool}`)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-background py-20 md:py-24">
        <div className="mx-auto max-w-[820px] px-6">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("mcpPage.workflowTitle")}</h2>
          <p className="mt-5 rounded-lg border border-border/60 bg-muted/20 p-5 text-sm leading-relaxed text-muted-foreground">
            {t("mcpPage.workflowLine")}
          </p>
        </div>
      </section>

      <section className="border-t border-border bg-background-deep py-20 md:py-24">
        <div className="mx-auto max-w-[820px] px-6">
          <h2 className="text-xl font-semibold tracking-[-0.02em]">{t("mcpPage.troubleshootingTitle")}</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{t("mcpPage.troubleshootingBody")}</p>

          {isAuthenticated && (
            <Link
              href="/settings"
              className="mt-6 inline-block text-sm text-foreground underline underline-offset-4 hover:text-brand-violet"
            >
              {t("mcpPage.dashboardCta")}
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
