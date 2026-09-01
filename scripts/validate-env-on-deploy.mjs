#!/usr/bin/env node
// Runs env validation as part of the build, but only with real teeth when
// Vercel is actually building for Production -- that's the one place the
// real secrets are guaranteed to be present. Local dev builds and Preview
// deployments (which legitimately may not have every production secret)
// are left alone so this can't break unrelated work.
//
// M8 (audit): validate-env.mjs already existed but was never invoked
// anywhere in the deploy path, so a missing/malformed secret surfaced as
// an opaque runtime 500 instead of a failed deployment.
import { spawnSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv !== "production") {
  console.log(
    `Skipping production env validation (VERCEL_ENV=${vercelEnv ?? "unset"}, not "production").`
  );
  process.exit(0);
}

console.log("VERCEL_ENV=production — validating required environment variables before build...");
const result = spawnSync(process.execPath, ["scripts/validate-env.mjs", "--production"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
