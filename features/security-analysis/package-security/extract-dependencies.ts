import { discoverComponentsFromFiles, findLineNumber } from "../sbom/lockfile-parsers";
import type { RepositoryFile, SbomComponent, SbomEcosystem } from "../sbom/types";
import { NPM_BUILTIN_PACKAGES } from "./constants";
import type { DeclaredPackageDependency, PackageDependencyKind, PackageDependencySource } from "./types";

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function lineAt(content: string, needle: string): number {
  return findLineNumber(content, needle);
}

function classifyNpmVersion(versionRange: string): PackageDependencyKind {
  const value = versionRange.trim();
  if (/^workspace:/.test(value)) return "workspace";
  if (/^(file:|link:)/.test(value)) return value.startsWith("link:") ? "link" : "file";
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(value)) return "git";
  if (/^https?:\/\//.test(value)) return "git";
  return "registry";
}

function parseScopedName(name: string): { name: string; scope?: string } {
  const match = name.match(/^(@[^/]+\/)(.+)$/);
  if (!match) return { name };
  return { name, scope: match[1]?.slice(0, -1) };
}

function pushDependency(
  deps: DeclaredPackageDependency[],
  input: Omit<DeclaredPackageDependency, "scope"> & { scope?: string }
): void {
  const parsed = parseScopedName(input.name);
  deps.push({ ...input, scope: parsed.scope ?? input.scope });
}

function parseRequirementsTxt(path: string, content: string): DeclaredPackageDependency[] {
  const deps: DeclaredPackageDependency[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]?.trim() ?? "";
    if (!raw || raw.startsWith("#") || raw.startsWith("-r ") || raw.startsWith("-c ")) continue;
    const match = raw.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[.*\])?(?:[=<>!~]=|[<>=~!]|$)/);
    if (!match?.[1]) continue;
    const name = match[1].replace(/_/g, "-").toLowerCase();
    const versionMatch = raw.match(/[=<>!~]=\s*([^\s;#]+)/);
    pushDependency(deps, {
      name,
      version: versionMatch?.[1] ?? "unknown",
      ecosystem: "pypi",
      file: path,
      line: index + 1,
      source: "requirements",
      kind: /^(\.\/|\.\.\/|file:|git\+)/.test(raw) ? "local-path" : "registry",
    });
  }
  return deps;
}

function parsePyprojectToml(path: string, content: string): DeclaredPackageDependency[] {
  const deps: DeclaredPackageDependency[] = [];
  const depBlock =
    content.match(/\[project\.dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1] ??
    content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  if (!depBlock) return deps;

  for (const match of depBlock.matchAll(/^\s*"?([A-Za-z0-9][A-Za-z0-9._-]*)"?\s*=\s*"([^"]+)"/gm)) {
    const name = match[1]?.replace(/_/g, "-").toLowerCase();
    if (!name || name === "python") continue;
    pushDependency(deps, {
      name,
      version: match[2] ?? "unknown",
      ecosystem: "pypi",
      file: path,
      line: lineAt(content, match[0]),
      source: "pyproject",
      kind: "registry",
    });
  }
  return deps;
}

function parseCargoToml(path: string, content: string): DeclaredPackageDependency[] {
  const deps: DeclaredPackageDependency[] = [];
  const depBlock = content.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/)?.[1];
  if (!depBlock) return deps;
  for (const match of depBlock.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/gm)) {
    pushDependency(deps, {
      name: match[1]!,
      version: match[2] ?? "unknown",
      ecosystem: "crates",
      file: path,
      line: lineAt(content, match[0]),
      source: "cargo",
      kind: "registry",
    });
  }
  return deps;
}

function parseGoMod(path: string, content: string): DeclaredPackageDependency[] {
  const deps: DeclaredPackageDependency[] = [];
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/)?.[1];
  const lines = requireBlock ? requireBlock.split("\n") : content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const match = trimmed.match(/^([^\s]+)\s+([^\s]+)/);
    if (!match) continue;
    const modPath = match[1]!;
    if (modPath === "require" || modPath.startsWith("replace")) continue;
    pushDependency(deps, {
      name: modPath,
      version: match[2] ?? "unknown",
      ecosystem: "go",
      file: path,
      line: lineAt(content, modPath),
      source: "go-mod",
      kind: modPath.includes("/./") || modPath.startsWith("./") ? "local-path" : "registry",
    });
  }
  return deps;
}

function parseGemfile(path: string, content: string): DeclaredPackageDependency[] {
  const deps: DeclaredPackageDependency[] = [];
  for (const match of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"](?:,\s*['"]([^'"]+)['"])?/gm)) {
    pushDependency(deps, {
      name: match[1]!,
      version: match[2] ?? "unknown",
      ecosystem: "rubygems",
      file: path,
      line: lineAt(content, match[0]),
      source: "gemfile",
      kind: "registry",
    });
  }
  return deps;
}

function parsePackageJsonManifest(path: string, content: string): DeclaredPackageDependency[] {
  const manifest = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    workspaces?: string[] | { packages?: string[] };
  };
  const deps: DeclaredPackageDependency[] = [];
  const sections: Array<[Record<string, string> | undefined, boolean]> = [
    [manifest.dependencies, false],
    [manifest.devDependencies, true],
    [manifest.optionalDependencies, false],
  ];
  for (const [section, isDev] of sections) {
    for (const [name, versionRange] of Object.entries(section ?? {})) {
      pushDependency(deps, {
        name,
        version: versionRange.replace(/^[\^~>=<\s]+/, "").split(",")[0]?.trim() || "unknown",
        ecosystem: "npm",
        file: path,
        line: lineAt(content, `"${name}"`),
        source: "manifest",
        kind: classifyNpmVersion(versionRange),
        isDev,
      });
    }
  }
  return deps;
}

function fromSbomComponents(components: SbomComponent[]): DeclaredPackageDependency[] {
  return components.map((component) => ({
    name: component.name,
    version: component.version,
    ecosystem: component.ecosystem,
    file: component.lockfilePath ?? "unknown",
    line: 1,
    source: component.lockfilePath?.endsWith("package.json") ? "manifest" : "lockfile",
    kind: "registry" as const,
    isDev: component.isDev,
    scope: component.namespace,
  }));
}

export function extractDeclaredDependencies(
  files: RepositoryFile[],
  options?: { sbomComponents?: SbomComponent[] }
): DeclaredPackageDependency[] {
  const deps: DeclaredPackageDependency[] = [];
  const workspaceNames = new Set<string>();

  for (const file of files) {
    const name = basename(file.path);
    if (name !== "package.json") continue;
    try {
      const manifest = JSON.parse(file.content) as {
        name?: string;
        workspaces?: string[] | { packages?: string[] };
      };
      if (manifest.name) workspaceNames.add(manifest.name);
      const workspaces = Array.isArray(manifest.workspaces)
        ? manifest.workspaces
        : manifest.workspaces?.packages ?? [];
      for (const pattern of workspaces) {
        workspaceNames.add(pattern.replace(/\*$/, "").replace(/\/$/, ""));
      }
    } catch {
      // ignore malformed package.json
    }
  }

  for (const file of files) {
    const name = basename(file.path);
    try {
      switch (name) {
        case "package.json":
          deps.push(...parsePackageJsonManifest(file.path, file.content));
          break;
        case "requirements.txt":
          deps.push(...parseRequirementsTxt(file.path, file.content));
          break;
        case "pyproject.toml":
          deps.push(...parsePyprojectToml(file.path, file.content));
          break;
        case "Cargo.toml":
          deps.push(...parseCargoToml(file.path, file.content));
          break;
        case "go.mod":
          deps.push(...parseGoMod(file.path, file.content));
          break;
        case "Gemfile":
          deps.push(...parseGemfile(file.path, file.content));
          break;
        default:
          break;
      }
    } catch {
      // ignore malformed manifests
    }
  }

  deps.push(
    ...(options?.sbomComponents
      ? fromSbomComponents(options.sbomComponents)
      : fromSbomComponents(discoverComponentsFromFiles(files, { includeDev: true })))
  );

  return dedupeDeclaredDependencies(deps, workspaceNames);
}

export function dedupeDeclaredDependencies(
  deps: DeclaredPackageDependency[],
  workspaceNames: Set<string> = new Set()
): DeclaredPackageDependency[] {
  const seen = new Map<string, DeclaredPackageDependency>();
  for (const dep of deps) {
    if (NPM_BUILTIN_PACKAGES.has(dep.name)) continue;
    if (workspaceNames.has(dep.name)) {
      dep.kind = "workspace";
    }
    const key = `${dep.ecosystem}:${dep.name.toLowerCase()}`;
    const existing = seen.get(key);
    if (!existing || sourcePriority(dep.source) > sourcePriority(existing.source)) {
      seen.set(key, dep);
    }
  }
  return [...seen.values()];
}

function sourcePriority(source: PackageDependencySource): number {
  switch (source) {
    case "lockfile":
      return 4;
    case "manifest":
      return 3;
    case "pyproject":
    case "cargo":
    case "go-mod":
    case "gemfile":
      return 3;
    case "requirements":
      return 2;
    default:
      return 1;
  }
}

export function detectPrimaryEcosystems(files: RepositoryFile[]): Set<SbomEcosystem> {
  const ecosystems = new Set<SbomEcosystem>();
  for (const file of files) {
    const name = basename(file.path);
    if (name === "package.json" || name.endsWith("package-lock.json") || name === "yarn.lock") {
      ecosystems.add("npm");
    }
    if (name === "requirements.txt" || name === "pyproject.toml" || name === "poetry.lock") {
      ecosystems.add("pypi");
    }
    if (name === "Cargo.toml" || name === "Cargo.lock") ecosystems.add("crates");
    if (name === "go.mod" || name === "go.sum") ecosystems.add("go");
    if (name === "Gemfile" || name === "Gemfile.lock") ecosystems.add("rubygems");
  }
  return ecosystems;
}

export function isInternalDependency(dep: DeclaredPackageDependency): boolean {
  return (
    dep.kind === "workspace" ||
    dep.kind === "local-path" ||
    dep.kind === "git" ||
    dep.kind === "file" ||
    dep.kind === "link"
  );
}

export function isLikelyPrivatePackage(dep: DeclaredPackageDependency): boolean {
  if (isInternalDependency(dep)) return true;
  if (dep.name.startsWith("internal-") || dep.name.startsWith("private-")) return true;
  if (dep.ecosystem === "npm" && dep.name.startsWith("@") && dep.scope && !isLikelyPublicScope(dep.scope)) {
    return true;
  }
  return false;
}

function isLikelyPublicScope(scope: string): boolean {
  const normalized = scope.replace(/^@/, "").toLowerCase();
  return ["types", "babel", "typescript-eslint", "eslint", "vue", "angular", "nestjs", "radix-ui"].some((prefix) =>
    normalized.startsWith(prefix)
  );
}

export function detectEcosystemMismatch(
  dep: DeclaredPackageDependency,
  primaryEcosystems: Set<SbomEcosystem>
): boolean {
  if (primaryEcosystems.size <= 1) return false;
  if (dep.ecosystem === "npm" && primaryEcosystems.has("pypi") && !primaryEcosystems.has("npm")) {
    return true;
  }
  if (dep.ecosystem === "pypi" && primaryEcosystems.has("npm") && !primaryEcosystems.has("pypi")) {
    return true;
  }
  return false;
}
