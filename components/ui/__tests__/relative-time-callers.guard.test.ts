import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every client component that prints a time relative to now must do it through <RelativeTimeLabel> (deterministic first render): calling the
// formatters while rendering, or hiding the mismatch with suppressHydrationWarning, brings back the intermittent #418 ("text").
function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}
const callers = ["app", "components", "features"]
  .flatMap((root) => Array.from(sources(root)))
  .filter((file) => /\b(formatRelativeLocalized|formatRelativeDate)\(/.test(readFileSync(file, "utf8")))
  .filter((file) => !file.startsWith("lib/"));

describe("relative-time call sites", () => {
  it("are found (the guard is not vacuous)", () => {
    expect(callers.length).toBeGreaterThanOrEqual(9);
  });

  it.each(callers)("%s calls the formatter only inside RelativeTimeLabel's `format`", (file) => {
    const text = readFileSync(file, "utf8");
    // Server components render once and are never hydrated: no comparison, no problem.
    if (!/^["']use client["']/m.test(text.split("\n").slice(0, 3).join("\n"))) return;
    expect(text).toContain("RelativeTimeLabel");
    expect(text).not.toContain("suppressHydrationWarning");
    const calls = (text.match(/\b(formatRelativeLocalized|formatRelativeDate)\(/g) ?? []).length;
    const lambdas = (text.match(/\(now\) =>/g) ?? []).length;
    expect(calls).toBeGreaterThan(0);
    expect(lambdas).toBe(calls); // every call lives inside a `(now) =>` handed to RelativeTimeLabel
  });
});
