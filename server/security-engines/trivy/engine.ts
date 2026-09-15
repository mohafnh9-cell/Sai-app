import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  EngineApplicabilityInput,
  EngineApplicabilityResult,
  EngineExecuteInput,
  EngineHealthCheckResult,
  EngineResult,
  SecurityEngine,
} from "../types";
import { resolveSafeWorkspacePath, safeExec, withIsolatedWorkspace, WorkspacePathEscapeError } from "../subprocess/safe-exec";
import { fromTrivyReport, type TrivyReport } from "./normalize";

/**
 * Phase 35, section 9/10: verified against the real, currently-published
 * aquasecurity/trivy GitHub release as of this phase (repository:
 * https://github.com/aquasecurity/trivy, version 0.74.0, LICENSE =
 * Apache-2.0 -- notably relicensed FROM AGPL-3.0 TO Apache-2.0 early in the
 * project specifically to be safe for commercial/SaaS use). Pinned
 * explicitly -- never "latest".
 */
export const TRIVY_VERSION = "0.74.0";
export const TRIVY_LICENSE = "Apache-2.0";
export const TRIVY_REPOSITORY = "https://github.com/aquasecurity/trivy";

const DEPENDENCY_MANIFESTS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "requirements.txt",
  "poetry.lock",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
];
const DOCKERFILE_PATTERN = /(^|\/)Dockerfile(\.[a-zA-Z0-9_-]+)?$/;
const TERRAFORM_PATTERN = /\.tf$/;
const K8S_HINT_PATTERN = /(^|\/)(k8s|kubernetes)\//i;

function resolveBinaryPath(): string | null {
  return process.env.TRIVY_BINARY_PATH?.trim() || null;
}

function resolveCacheDir(): string {
  return process.env.TRIVY_CACHE_DIR?.trim() || "/tmp/sequrai-trivy-cache";
}

function hasDependencyManifest(files: EngineApplicabilityInput["files"]): boolean {
  return files.some((f) => DEPENDENCY_MANIFESTS.some((name) => f.path.endsWith(name)));
}

function hasDockerfile(files: EngineApplicabilityInput["files"]): boolean {
  return files.some((f) => DOCKERFILE_PATTERN.test(f.path));
}

function hasTerraform(files: EngineApplicabilityInput["files"]): boolean {
  return files.some((f) => TERRAFORM_PATTERN.test(f.path));
}

function hasKubernetesManifest(files: EngineApplicabilityInput["files"]): boolean {
  return files.some((f) => K8S_HINT_PATTERN.test(f.path) && (f.path.endsWith(".yaml") || f.path.endsWith(".yml")));
}

/**
 * Section 10: separate the (large, cacheable, network-dependent)
 * vulnerability-DB update from the (fast, offline) per-customer scan. Only
 * called when the cache is actually stale/missing -- not on every scan.
 */
async function ensureVulnerabilityDbWarm(binary: string, cacheDir: string, timeoutMs: number): Promise<boolean> {
  const result = await safeExec({
    command: binary,
    args: ["fs", "--cache-dir", cacheDir, "--download-db-only", "/tmp"],
    cwd: "/tmp",
    timeoutMs,
    envAllowlist: { DOCKER_CONFIG: cacheDir },
  });
  return result.exitCode === 0;
}

export function createTrivyEngine(): SecurityEngine {
  return {
    id: "trivy",
    name: "Trivy",
    version: TRIVY_VERSION,
    capabilities: [
      { id: "dependencies", engine: "trivy", expensive: true, networkRequired: true, requiresExternalBinary: true },
      { id: "containers", engine: "trivy", expensive: true, networkRequired: true, requiresExternalBinary: true },
      { id: "iac", engine: "trivy", expensive: false, networkRequired: false, requiresExternalBinary: true },
      { id: "sbom", engine: "trivy", expensive: true, networkRequired: true, requiresExternalBinary: true },
    ],

    applicability(input: EngineApplicabilityInput): EngineApplicabilityResult {
      const matched: EngineApplicabilityResult["matchedCapabilities"] = [];
      if (hasDependencyManifest(input.files)) matched.push("dependencies", "sbom");
      if (hasDockerfile(input.files)) matched.push("containers");
      if (hasTerraform(input.files) || hasKubernetesManifest(input.files)) matched.push("iac");

      if (matched.length === 0) {
        return { applicable: false, reason: "no dependency manifest, Dockerfile, or IaC file found", matchedCapabilities: [] };
      }
      return { applicable: true, reason: `matched: ${matched.join(", ")}`, matchedCapabilities: matched };
    },

    async healthCheck(): Promise<EngineHealthCheckResult> {
      const binary = resolveBinaryPath();
      if (!binary) return { healthy: false, reason: "TRIVY_BINARY_PATH is not configured" };
      const result = await safeExec({ command: binary, args: ["--version"], cwd: "/tmp", timeoutMs: 5_000 });
      if (result.exitCode !== 0) return { healthy: false, reason: `trivy --version exited ${result.exitCode}` };
      const versionMatch = result.stdout.match(/Version:\s*([\d.]+)/);
      return { healthy: true, reason: "trivy responded to --version", detectedVersion: versionMatch?.[1] };
    },

    async execute(input: EngineExecuteInput): Promise<EngineResult> {
      const executionId = randomUUID();
      const startedAt = new Date().toISOString();
      const started = Date.now();
      const binary = resolveBinaryPath();
      const capabilitiesAttempted = ["dependencies", "sbom", "containers", "iac"] as const;

      const base = {
        engine: "trivy" as const,
        engineVersion: TRIVY_VERSION,
        executionId,
        scanId: input.scanId,
        projectId: input.projectId,
        organizationId: input.organizationId,
        startedAt,
        capabilitiesAttempted: [...capabilitiesAttempted],
      };

      if (!binary) {
        return {
          ...base,
          status: "SKIPPED",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "not_configured", message: "TRIVY_BINARY_PATH is not set for this environment" }],
        };
      }

      const cacheDir = resolveCacheDir();
      const errors: EngineResult["errors"] = [];

      if (input.signal?.aborted) {
        return {
          ...base,
          status: "SKIPPED",
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - started,
          capabilitiesCompleted: [],
          findings: [],
          evidence: [],
          metrics: {},
          errors: [{ code: "cancelled", message: "Cancelled before Trivy started." }],
        };
      }

      try {
        const dbWarm = await ensureVulnerabilityDbWarm(binary, cacheDir, Math.min(60_000, input.timeoutMs));
        if (!dbWarm) {
          errors.push({ code: "db_update_failed", message: "vulnerability database could not be updated/verified" });
        }
      } catch (error) {
        errors.push({ code: "db_update_error", message: error instanceof Error ? error.message : String(error) });
      }

      let report: TrivyReport | null = null;

      try {
        report = await withIsolatedWorkspace("trivy-scan", async (workspaceDir) => {
          for (const file of input.files) {
            // Section 11/40: repository-supplied paths are untrusted --
            // reject anything that would escape the isolated workspace
            // (e.g. a crafted "../../etc/..." entry) rather than write it.
            let target: string;
            try {
              target = resolveSafeWorkspacePath(workspaceDir, file.path);
            } catch (pathError) {
              if (pathError instanceof WorkspacePathEscapeError) {
                errors.push({ code: "unsafe_path_skipped", message: pathError.message });
                continue;
              }
              throw pathError;
            }
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, file.content, "utf8");
          }

          const result = await safeExec({
            command: binary,
            args: [
              "fs",
              "--cache-dir",
              cacheDir,
              "--skip-db-update",
              "--offline-scan",
              "--scanners",
              "vuln,misconfig",
              "--format",
              "json",
              workspaceDir,
            ],
            cwd: workspaceDir,
            timeoutMs: input.timeoutMs,
            envAllowlist: { DOCKER_CONFIG: cacheDir },
            signal: input.signal,
          });

          if (result.aborted) {
            errors.push({ code: "cancelled", message: "trivy fs scan was cancelled" });
            return null;
          }
          if (result.timedOut) {
            errors.push({ code: "timeout", message: "trivy fs scan exceeded the execution timeout" });
            return null;
          }
          if (result.exitCode !== 0) {
            errors.push({ code: "scan_failed", message: `trivy exited ${result.exitCode}` });
            return null;
          }
          try {
            return JSON.parse(result.stdout) as TrivyReport;
          } catch {
            errors.push({ code: "parse_failed", message: "could not parse trivy JSON output" });
            return null;
          }
        });
      } catch (error) {
        errors.push({ code: "workspace_error", message: error instanceof Error ? error.message : String(error) });
      }

      const { findings, evidence } = report
        ? fromTrivyReport(report, { scanId: input.scanId, projectId: input.projectId, organizationId: input.organizationId })
        : { findings: [], evidence: [] };

      const status = report ? (errors.length > 0 ? "PARTIAL" : "COMPLETED") : "FAILED";

      return {
        ...base,
        status,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        capabilitiesCompleted: report ? [...capabilitiesAttempted] : [],
        findings,
        evidence,
        metrics: { vulnerabilitiesFound: findings.length },
        errors,
      };
    },
  };
}
