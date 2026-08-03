"use client";

import Link from "next/link";
import { BrandLogo } from "@/components/landing/brand-logo";
import { NAV_LINKS } from "@/content/landing";
import { useI18n } from "@/lib/i18n/client";

export function Footer() {
  const { t: tl } = useI18n("landing");
  const { t: tn } = useI18n("navigation");

  return (
    <footer className="border-t border-border bg-background-deep py-14 md:py-16">
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-1">
            <BrandLogo />
            <p className="mt-4 max-w-xs text-sm text-text-muted">{tl("footer.tagline")}</p>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{tl("footer.product")}</p>
            <div className="mt-4 flex flex-col gap-2.5 text-sm text-muted-foreground">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="hover:text-foreground transition-colors"
                >
                  {tn(link.labelKey)}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{tl("footer.company")}</p>
            <div className="mt-4 flex flex-col gap-2.5 text-sm text-muted-foreground">
              <Link href="mailto:hi@sequrai.com" className="hover:text-foreground transition-colors">
                {tl("footer.contact")}
              </Link>
            </div>
          </div>

          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-text-muted">{tl("footer.legal")}</p>
            <div className="mt-4 flex flex-col gap-2.5 text-sm text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                {tl("footer.privacy")}
              </Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                {tl("footer.terms")}
              </Link>
            </div>
          </div>
        </div>

        <p className="mt-12 text-xs text-text-muted">{tl("footer.copyright")}</p>
      </div>
    </footer>
  );
}
