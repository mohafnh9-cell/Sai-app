#!/usr/bin/env node
/**
 * Validates Red Team plugin manifests (RT9, RT10) via vitest stabilization suite.
 * Usage: npm run validate:red-team -- [team-id]
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const teamId = process.argv[2]?.trim();
const cwd = resolve(process.cwd());
const args = ["vitest", "run", "server/ai-red-team/stabilization"];
if (teamId) {
  args.push("--", "-t", teamId);
}

const result = spawnSync("npx", args, { cwd, stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
