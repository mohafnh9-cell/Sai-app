"use client";

import { useEffect } from "react";
import { geistSans, geistMono } from "@/lib/fonts";

/**
 * Opts a page into the SequrAI product palette (dark graphite/metal
 * surfaces, single teal accent, amber/coral severity) instead of the
 * landing's purple/violet theme -- the same `data-app-shell` scoping
 * DashboardShell.tsx already uses (see app/globals.css's `.app-shell` /
 * `html[data-app-shell="true"]` block). Use this on any non-landing,
 * non-authenticated-dashboard page that should still look like the SequrAI
 * product (auth screens, /mcp, /demo, /onboarding, /privacy, /terms) --
 * never on the real public landing (app/page.tsx) or app/(legacy)/old-landing,
 * which must keep rendering the root theme unchanged.
 *
 * Set on `<html>`, not a wrapper element, because Radix portals (dialogs,
 * dropdowns) render into `document.body`, a sibling of any wrapper this
 * component could render -- only a shared ancestor like `<html>` reaches
 * both. Mirrors DashboardShell's own effect exactly.
 *
 * Also attaches the Geist font-variable classes, for the same reason
 * DashboardShell does: the CSS rule that keys the app-shell typeface off
 * `data-app-shell` references `var(--font-geist-sans)` unconditionally --
 * setting the attribute WITHOUT this class leaves that custom property
 * undefined, which invalidates the whole `font-family` declaration (an
 * unlayered rule, so it still wins the cascade over the layered Inter
 * fallback) and silently drops every scoped page to the browser's serif
 * default. Confirmed live: without this, /login rendered its headings in
 * Times, not Inter/Geist.
 */
export function AppPaletteScope({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-app-shell", "true");
    html.classList.add(geistSans.variable, geistMono.variable);
    return () => {
      html.removeAttribute("data-app-shell");
      html.classList.remove(geistSans.variable, geistMono.variable);
    };
  }, []);

  return <>{children}</>;
}
