import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKER_BUILD_COMMIT, workerIdFor } from "../worker-build";

describe("worker build identity (observable from claimed_by, logs and /health)", () => {
  it("embeds the short commit in the worker id when known", () => {
    expect(workerIdFor({ commit: "7aca1353e8eb28cf29855dfcecad9e7acc913c6d", pid: 1, startedAtMs: 1791977970506 })).toBe("worker-7aca135-1-1791977970506");
  });
  it("says so when the commit is unknown instead of inventing one", () => {
    expect(workerIdFor({ commit: "unknown", pid: 1, startedAtMs: 5 })).toBe("worker-nocommit-1-5");
  });
  it("an explicit SECURITY_WORKER_ID still wins", () => {
    expect(workerIdFor({ explicit: " custom-1 ", commit: "abc", pid: 1, startedAtMs: 5 })).toBe("custom-1");
  });
  it("outside the bundle the commit is 'unknown'", () => {
    expect(WORKER_BUILD_COMMIT).toBe("unknown");
  });
  it("the bundler injects the commit into the worker bundle (WORKER_BUILD_COMMIT env)", () => {
    execFileSync("node", ["scripts/bundle-security-worker.mjs"], { env: { ...process.env, WORKER_BUILD_COMMIT: "deadbeefcafe0000000000000000000000000000" }, stdio: "ignore" });
    expect(readFileSync("worker/dist/worker-bundle.cjs", "utf8")).toContain("deadbeefcafe0000000000000000000000000000");
  }, 60_000);
});
