import type { SbomEcosystem } from "../sbom/types";

export const PACKAGE_SECURITY_RULE_ID = "package-security.scan-packages" as const;
export const PACKAGE_SECURITY_SOURCE_TOOL = "scan_packages" as const;

export const PACKAGE_SECURITY_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  "venv",
  ".venv",
  "coverage",
  ".next",
]);

export const MANIFEST_FILENAMES = new Set([
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Gemfile",
]);

export const LOCKFILE_FILENAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "Pipfile",
  "Pipfile.lock",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
]);

export const REGISTRY_TIMEOUT_MS = 8_000;
export const REGISTRY_LOOKUP_CONCURRENCY = 8;

export const REGISTRY_SUPPORTED_ECOSYSTEMS = new Set<SbomEcosystem>([
  "npm",
  "pypi",
  "crates",
  "rubygems",
  "go",
]);

export const PACKAGE_SECURITY_CATEGORY_REMEDIATION: Record<string, string> = {
  "package-hallucination":
    "Verify this dependency exists in the public registry before installing it. AI-generated package names are often incorrect or hallucinated.",
  "package-typosquat":
    "Confirm the intended package name. Similar-looking packages may be typosquats designed to trick dependency resolution.",
  "dependency-confusion":
    "Ensure internal or scoped package names cannot be satisfied by an unexpected public package with the same unscoped name.",
  "ecosystem-mismatch":
    "Review whether this dependency belongs in the detected repository ecosystem or was generated for the wrong package manager.",
};

export const NPM_BUILTIN_PACKAGES = new Set([
  "node",
  "fs",
  "path",
  "http",
  "https",
  "crypto",
  "util",
  "stream",
  "events",
  "buffer",
  "os",
  "child_process",
  "assert",
  "url",
  "querystring",
  "zlib",
  "net",
  "tls",
  "dns",
  "readline",
  "cluster",
  "worker_threads",
  "perf_hooks",
  "v8",
  "vm",
  "module",
  "process",
]);
