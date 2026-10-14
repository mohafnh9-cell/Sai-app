import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Every client component that prints a time relative to now must do it through <RelativeTimeLabel> (deterministic first render): calling the
// formatters while rendering, or hiding the mismatch with suppressHydrationWarning, brings back the intermittent #418 ("text").
const callers = execFileSync("git", ["grep", "-l", "-E", "formatRelativeLocalized\\(|formatRelativeDate\\(", "--", "app", "components", "features"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !/__tests__|\.test\./.test(f));

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
