import { describe, expect, it } from "vitest";
import {
  deduplicateFindings,
  detectStack,
  findingFingerprint,
  normalizeFiles,
  redactEvidence,
  resolveConfig,
  sanitizePath,
  scoreFindings,
  type Finding,
} from "../index";

describe("path and file normalization", () => {
  it("normalizes safe relative paths and rejects escapes", () => {
    expect(sanitizePath("./src\\api//route.ts")).toBe("src/api/route.ts");
    expect(sanitizePath("../../etc/passwd")).toBeNull();
    expect(sanitizePath("/etc/passwd")).toBeNull();
    expect(sanitizePath("C:\\secrets.txt")).toBeNull();
  });

  it("enforces ignored, binary, per-file, and total limits", () => {
    const result = normalizeFiles([
      { path: "node_modules/a.js", content: "x" },
      { path: "image.png", content: "not actually png" },
      { path: "large.ts", content: "12345" },
      { path: "ok.ts", content: "let x=1\r\n" },
    ], resolveConfig({ maxFileBytes: 4, maxTotalBytes: 10 }));
    expect(result.files).toHaveLength(0);
    expect(result.omissions.map((item) => item.reason)).toEqual([
      "binary", "file-too-large", "ignored", "file-too-large",
    ]);
  });

  it("stops accepting files at configured aggregate limits", () => {
    const result = normalizeFiles([
      { path: "a.ts", content: "1234" },
      { path: "b.ts", content: "5678" },
    ], resolveConfig({ maxFileBytes: 10, maxTotalBytes: 4 }));
    expect(result.files.map((file) => file.path)).toEqual(["a.ts"]);
    expect(result.omissions).toContainEqual({ path: "b.ts", reason: "total-limit" });
    expect(result.truncated).toBe(true);
  });

  it("omits unsupported, generated, minified, mapped, and asset files", () => {
    const result = normalizeFiles([
      { path: "notes.txt", content: "text" },
      { path: "public/assets/app.ts", content: "const x = 1" },
      { path: "bundle.min.js", content: "x=1" },
      { path: "bundle.js.map", content: "{}" },
      { path: "src/app.ts", content: "const ok = true" },
    ], resolveConfig());
    expect(result.files.map((file) => file.path)).toEqual(["src/app.ts"]);
    expect(result.omissions).toHaveLength(4);
  });
});

describe("deterministic utilities", () => {
  it("redacts secret values without leaking them", () => {
    const output = redactEvidence("API_KEY=super-secret-value token=ghp_abcdefghijklmnopqrstuvwxyz");
    expect(output).not.toContain("super-secret-value");
    expect(output).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    expect(output).toContain("…");
  });

  it("creates stable fingerprints and removes duplicates", () => {
    const fingerprint = findingFingerprint("rule", "A.ts", 3, "x");
    expect(fingerprint).toBe(findingFingerprint("rule", "a.ts", 3, " X "));
    const finding: Finding = {
      id: "one", fingerprint, correlationKey: "corr-one", ruleId: "rule", title: "Title", description: "Description",
      severity: "high", confidence: "high", category: "test",
      location: { path: "a.ts", line: 3 }, remediation: "Fix it",
    };
    expect(deduplicateFindings([finding, { ...finding, id: "two" }])).toHaveLength(1);
  });

  it("detects stack and calculates bounded scores", () => {
    const normalized = normalizeFiles([
      { path: "package.json", content: '{"dependencies":{"next":"16","@supabase/supabase-js":"2"}}' },
      { path: "src/a.tsx", content: "import React from 'react'" },
      { path: "package-lock.json", content: "{}" },
    ], resolveConfig());
    expect(detectStack(normalized.files)).toEqual({
      languages: ["TypeScript"],
      frameworks: ["Next.js", "React"],
      services: ["Supabase"],
      packageManagers: ["npm"],
      dependencies: { "@supabase/supabase-js": "2", next: "16" },
    });
    const credentialedDependency = normalizeFiles([
      {
        path: "package.json",
        content:
          '{"dependencies":{"private-package":"https://user:secret@example.com/repo.git"}}',
      },
    ], resolveConfig());
    expect(
      detectStack(credentialedDependency.files).dependencies["private-package"]
    ).toBe("[remote-reference]");
    const base = {
      id: "x", fingerprint: "x", correlationKey: "corr-x", ruleId: "x", title: "x", description: "x",
      confidence: "high" as const, category: "x", location: { path: "x", line: 1 }, remediation: "x",
    };
    expect(scoreFindings([{ ...base, severity: "critical" }, { ...base, severity: "high" }]).score).toBe(60);
    expect(
      scoreFindings(
        Array.from({ length: 20 }, (_, index) => ({
          ...base,
          id: String(index),
          fingerprint: String(index),
          severity: "low" as const,
        })),
      ).score,
    ).toBe(94);
  });
});
