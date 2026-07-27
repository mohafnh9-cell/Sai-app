import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function listTsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listTsFiles(full, acc);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) acc.push(full.replace(`${ROOT}/`, ""));
  }
  return acc;
}

describe("architecture inventory — module boundaries", () => {
  it("indexes RT-Core, RT9, RT10 module counts", () => {
    const core = listTsFiles(join(ROOT, "core")).length;
    const rt9 = listTsFiles(join(ROOT, "business-logic")).length;
    const rt10 = listTsFiles(join(ROOT, "llm-team")).length;
    expect(core).toBeGreaterThan(40);
    expect(rt9).toBeGreaterThanOrEqual(70);
    expect(rt10).toBeGreaterThanOrEqual(65);
  });

  it("RT9 and RT10 declare declarative manifests", () => {
    expect(listTsFiles(join(ROOT, "business-logic/declarative"))).toContain(
      "business-logic/declarative/manifest.ts"
    );
    expect(listTsFiles(join(ROOT, "llm-team/declarative"))).toContain("llm-team/declarative/manifest.ts");
  });
});
