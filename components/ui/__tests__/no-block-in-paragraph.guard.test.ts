import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Found by the full-page hydration matrix (scripts/e2e-hydration.mjs): Journey's review history put <Badge> (it renders a <div>) inside a <p>.
// A <div> inside a <p> is invalid HTML: the browser closes the <p> while parsing the server HTML, React's tree no longer matches and
// hydration fails (minified error #418, args "HTML"), on EVERY load, in every zone and locale. This keeps the pattern from coming back.
const BLOCK = /<(div|Badge|Card[A-Za-z]*|section|ul|ol|table|form|h[1-6]|VerdictStatusBadge|ProductionScoreDisplay|pre|blockquote|hr)[\s>/]/;

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}
const files = ["app", "components", "features"].flatMap((root) => Array.from(sources(root)));

describe("no block-level element inside a <p>", () => {
  it("looks at many files (the guard is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds no <p> whose JSX children contain a block-level element or a component that renders one", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)) {
        const found = BLOCK.exec(match[1]);
        if (found) offenders.push(`${file}:${text.slice(0, match.index).split("\n").length} <${found[1]}> inside <p>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the check can fail (control)", () => {
    const sample = `<p className="x"><Badge variant="outline">+1</Badge></p>`;
    expect(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/.exec(sample) && BLOCK.test(sample)).toBeTruthy();
  });
});
