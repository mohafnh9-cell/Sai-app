import { describe, it, expect } from "vitest";
import { scanRepository } from "@/features/security-scanner";
import type { InputFile } from "@/features/security-scanner/types";

/**
 * Phase 14 capacity benchmark -- NOT a correctness test. Measures the
 * deterministic scanner's real CPU/wall-clock behavior against synthetic
 * fixture repos, in this process, on this machine. Read alongside the
 * Phase 14 report: this sandbox's CPU is shared/throttled (see
 * vitest.config.ts's maxWorkers comment), so absolute numbers here are a
 * lower bound on real-world speed, not a production SLA. What IS reliable
 * from this run regardless of absolute hardware: the *shape* of the curve
 * (how duration scales with file count) and whether concurrent in-process
 * scans actually parallelize or serialize on the event loop.
 */

const SEEDED_VULNERABLE_SNIPPET = `
const apiKey = "sk-live-4242424242424242424242424242";
const query = "SELECT * FROM users WHERE id = " + userId;
exec("rm -rf " + userSuppliedPath);
const password = "hardcoded-super-secret-password-123";
document.innerHTML = userInput;
`;

function makeFile(index: number, ext: string): InputFile {
  const seedVuln = index % 7 === 0; // realistic sparse distribution of real findings
  const lines: string[] = [];
  lines.push(`// synthetic fixture file ${index}.${ext}`);
  lines.push(`import { helper${index} } from "./helper${index}";`);
  for (let line = 0; line < 60; line++) {
    lines.push(`function fn_${index}_${line}(a, b) { return a + b + ${line}; }`);
  }
  if (seedVuln) lines.push(SEEDED_VULNERABLE_SNIPPET);
  lines.push(`export default fn_${index}_0;`);
  return { path: `src/module_${index}.${ext}`, content: lines.join("\n") };
}

function makeRepo(fileCount: number): InputFile[] {
  const extensions = ["ts", "tsx", "js", "py"];
  return Array.from({ length: fileCount }, (_, i) => makeFile(i, extensions[i % extensions.length]));
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function benchOnce(files: InputFile[]) {
  const start = performance.now();
  const result = await scanRepository(files);
  const durationMs = performance.now() - start;
  return { durationMs, findings: result.findings.length, scannedBytes: result.metrics.scannedBytes };
}

async function benchRepeated(label: string, fileCount: number, runs: number) {
  const files = makeRepo(fileCount);
  const sourceBytes = files.reduce((sum, f) => sum + f.content.length, 0);
  const durations: number[] = [];
  let findings = 0;
  for (let i = 0; i < runs; i++) {
    const r = await benchOnce(files);
    durations.push(r.durationMs);
    findings = r.findings;
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const report = {
    label,
    fileCount,
    sourceBytes,
    runs,
    p50Ms: Math.round(percentile(sorted, 50)),
    p95Ms: Math.round(percentile(sorted, 95)),
    maxMs: Math.round(sorted[sorted.length - 1]),
    minMs: Math.round(sorted[0]),
    findings,
  };
  console.log(`PHASE14_BENCH ${JSON.stringify(report)}`);
  return report;
}

describe("Phase 14 -- scanner capacity benchmark", () => {
  it(
    "measures small/medium/large/very-large synthetic repos (p50/p95/max)",
    async () => {
      await benchRepeated("small_50files", 50, 5);
      await benchRepeated("medium_200files", 200, 5);
      await benchRepeated("large_750files", 750, 3);
      await benchRepeated("very_large_1750files", 1750, 3);
    },
    120_000
  );

  it(
    "measures in-process concurrency: does running N scans together parallelize or serialize?",
    async () => {
      const files = makeRepo(200); // medium repo, held constant
      const single = await benchOnce(files);
      console.log(`PHASE14_CONCURRENCY_BASELINE ${JSON.stringify({ singleScanMs: Math.round(single.durationMs) })}`);

      for (const n of [1, 5, 10, 20]) {
        const start = performance.now();
        await Promise.all(Array.from({ length: n }, () => scanRepository(files)));
        const totalMs = performance.now() - start;
        console.log(
          `PHASE14_CONCURRENCY ${JSON.stringify({
            concurrentScans: n,
            totalWallMs: Math.round(totalMs),
            perScanIfSerial: Math.round(single.durationMs * n),
            perScanIfPerfectParallel: Math.round(single.durationMs),
            speedupFactor: Number((single.durationMs * n / totalMs).toFixed(2)),
          })}`
        );
      }
      expect(true).toBe(true);
    },
    180_000
  );
});
