#!/usr/bin/env node
/**
 * Local release verification for Phase 1.6.
 * Runs typecheck, lint, test, build sequentially with timeouts.
 */

import { spawnSync, spawn } from "node:child_process";

const TIMEOUT_MS = 15 * 60 * 1000;

const steps = [
  { name: "typecheck", cmd: "npm", args: ["run", "typecheck"] },
  { name: "lint", cmd: "npm", args: ["run", "lint"] },
  { name: "test", cmd: "npm", args: ["run", "test"] },
  { name: "build", cmd: "npm", args: ["run", "build"] },
];

function runStep(step) {
  console.log(`\n=== ${step.name} ===`);
  const started = Date.now();
  const result = spawnSync(step.cmd, step.args, {
    stdio: "inherit",
    env: process.env,
    timeout: TIMEOUT_MS,
    maxBuffer: 50 * 1024 * 1024,
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (result.error?.code === "ETIMEDOUT") {
    console.error(`${step.name} timed out after ${TIMEOUT_MS / 60000} minutes`);
    return { name: step.name, ok: false, elapsed, error: "timeout" };
  }
  if (result.status !== 0) {
    return { name: step.name, ok: false, elapsed, exitCode: result.status ?? 1 };
  }
  return { name: step.name, ok: true, elapsed };
}

function checkZombieTsc() {
  const ps = spawnSync("ps", ["aux"], { encoding: "utf8" });
  const lines = ps.stdout.split("\n").filter((l) => l.includes("tsc --noEmit") || l.includes("tsc -p"));
  if (lines.length > 1) {
    console.warn(`WARN: ${lines.length} tsc processes detected — kill orphans before verifying:`);
    console.warn("  pkill -f 'tsc --noEmit'  # or restart terminal");
  }
}

console.log("Phase 1.6 local release verification");
console.log(`Node ${process.version} (package.json requires >=22)`);
checkZombieTsc();

const results = [];
for (const step of steps) {
  results.push(runStep(step));
  if (!results.at(-1).ok) break;
}

console.log("\n=== Summary ===");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.elapsed}s)${r.error ? ` — ${r.error}` : ""}`);
}

if (results.every((r) => r.ok)) {
  console.log("\nAll release checks passed.");
  process.exit(0);
}
console.log("\nRelease verification failed.");
process.exit(1);
