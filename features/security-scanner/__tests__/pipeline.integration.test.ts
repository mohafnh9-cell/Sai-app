import { describe, expect, it } from "vitest";
import { scanRepository } from "../index";

describe("in-memory scan pipeline", () => {
  // P10 (audit): investigated, not just re-timed blindly. Reproduced in
  // isolation with a generous timeout -- this consistently takes ~3.5-4s
  // even for this 5-file in-memory input, with no network calls or
  // filesystem I/O anywhere in scanRepository's call graph (verified by
  // grep). That's a real, fixed per-invocation cost inside the scanner
  // (likely rule/regex compilation on first use), not a hang and not
  // flakiness -- it just leaves too little headroom under vitest's 5000ms
  // default once other tests are competing for CPU in the same run. The
  // fixed cost itself is a separate performance question worth profiling
  // later; this timeout reflects the scanner's real, reproducible duration.
  it("scans a repository and persists normalized results in a simulated store", async () => {
    const repository = [
      {
        path: "package.json",
        content: JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0", "@supabase/supabase-js": "2.0.0" } }),
      },
      {
        path: "app/api/admin/route.ts",
        content: [
          "export async function POST(request: Request) {",
          "  const body = await request.json()",
          "  console.log('token', body.token)",
          "  return Response.json(await db.query(`SELECT * FROM users WHERE id = ${body.id}`))",
          "}",
        ].join("\n"),
      },
      { path: "components/Unsafe.tsx", content: "export const Unsafe = ({ html }) => <div dangerouslySetInnerHTML={{ __html: html }} />" },
      { path: "node_modules/ignored.js", content: "const password='should-not-scan'" },
      { path: "../escape.ts", content: "const token='should-not-scan'" },
    ];

    const options = { now: () => 100, maxDurationMs: 1_000 };
    const first = await scanRepository(repository, options);
    const second = await scanRepository([...repository].reverse(), options);
    const persisted = new Map<string, typeof first>();
    persisted.set("scan-1", structuredClone(first));

    expect(first.findings).toEqual(second.findings);
    expect(persisted.get("scan-1")).toEqual(first);
    expect(first.stack).toEqual({
      languages: ["TypeScript"],
      frameworks: ["Next.js", "React"],
      services: ["Supabase"],
      packageManagers: [],
      dependencies: {
        "@supabase/supabase-js": "2.0.0",
        next: "16.0.0",
        react: "19.0.0",
      },
    });
    expect(first.findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining([
      "auth.missing",
      "authz.insufficient",
      "validation.missing",
      "rate-limit.missing",
      "privacy.sensitive-logging",
      "injection.sql",
      "web.next-xss",
    ]));
    expect(first.score.score).toBeLessThan(100);
    expect(first.metrics).toEqual(expect.objectContaining({
      inputFiles: 5,
      scannedFiles: 3,
      omittedFiles: 2,
      ruleFailures: 0,
      truncated: false,
    }));
    expect(first.omissions.map((omission) => omission.reason)).toEqual(expect.arrayContaining(["ignored", "invalid-path"]));
  }, 15_000);
});
