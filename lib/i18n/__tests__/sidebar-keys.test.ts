import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Acceptance matrix 2026-10-14: "[i18n] Missing key: navigation.collapseSidebar" logged on every dashboard load, leaving the sidebar toggle
// without an accessible name. Every navigation key the sidebar asks for must exist in every locale.
describe("sidebar navigation keys", () => {
  const src = readFileSync("components/dashboard/sidebar.tsx", "utf8");
  const keys = [...src.matchAll(/\bt\("([A-Za-z.]+)"\)/g)].map((m) => m[1]);
  it.each(["en", "es"])("%s has every key used with t() in the sidebar", (loc) => {
    const d = JSON.parse(readFileSync(`messages/${loc}/navigation.json`, "utf8"));
    expect(keys.length).toBeGreaterThan(3);
    for (const k of keys) expect(k.split(".").reduce((n: any, p) => n?.[p], d), `${loc}:${k}`).toBeTypeOf("string");
  });
});
