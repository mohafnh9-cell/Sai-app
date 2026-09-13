"use client";

import { useEffect } from "react";

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
 */
export function AppPaletteScope({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("data-app-shell", "true");
    return () => {
      html.removeAttribute("data-app-shell");
    };
  }, []);

  return <>{children}</>;
}
