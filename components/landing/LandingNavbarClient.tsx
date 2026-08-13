"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrandLogoLink } from "@/components/landing/brand-logo";
import { NAV_LINKS } from "@/content/landing";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { useI18n } from "@/lib/i18n/client";

const LanguageSelector = dynamic(
  () =>
    import("@/components/shared/LanguageSelector").then((module) => ({
      default: module.LanguageSelector,
    })),
  { ssr: false, loading: () => null }
);

export function LandingNavbarClient() {
  const [scrolled, setScrolled] = useState(false);
  const { t } = useI18n("navigation");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 safe-top transition-all duration-500 ${
        scrolled
          ? "border-b border-border bg-background-deep/80 glass-surface"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex min-h-14 max-w-[1200px] items-center justify-between px-6 md:min-h-16">
        <BrandLogoLink />

        <nav className="hidden items-center gap-10 md:flex" aria-label="Primary">
          {(isBillingEnabled() ? NAV_LINKS : NAV_LINKS.filter((link) => link.href !== "#pricing")).map(
            (link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-[13px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {t(link.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <LanguageSelector variant="compact" />
          <Link
            href="/login"
            className="hidden text-[13px] text-muted-foreground transition-colors hover:text-foreground sm:inline"
          >
            {t("signIn")}
          </Link>
          <Button
            size="sm"
            className="h-9 rounded-full bg-brand-gradient px-4 text-[13px] font-medium hover:opacity-90"
            asChild
          >
            <Link href="/connect">{t("connectRepository")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
