import { createSbomComponent } from "./component";
import type { RepositoryFile, SbomComponent, SbomEcosystem } from "./types";

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function dedupeComponents(components: SbomComponent[]): SbomComponent[] {
  const seen = new Map<string, SbomComponent>();
  for (const component of components) {
    if (!seen.has(component.purl)) {
      seen.set(component.purl, component);
    }
  }
  return [...seen.values()];
}

function parsePackageLockJson(path: string, content: string): SbomComponent[] {
  const lock = JSON.parse(content) as {
    name?: string;
    version?: string;
    packages?: Record<
      string,
      { version?: string; dev?: boolean; devOptional?: boolean }
    >;
  };
  const packages = lock.packages ?? {};
  const rootEntry = packages[""] ?? {};
  const directNames = new Set([
    ...Object.keys((rootEntry as { dependencies?: Record<string, string> }).dependencies ?? {}),
    ...Object.keys((rootEntry as { devDependencies?: Record<string, string> }).devDependencies ?? {}),
    ...Object.keys((rootEntry as { optionalDependencies?: Record<string, string> }).optionalDependencies ?? {}),
  ]);
  const deps: SbomComponent[] = [];

  for (const [key, info] of Object.entries(packages)) {
    if (key === "" || !info.version) continue;
    const name = key.replace(/^node_modules\//, "").replace(/^.*node_modules\//, "");
    if (!name) continue;
    deps.push(
      createSbomComponent({
        name,
        version: info.version,
        ecosystem: "npm",
        isDev: Boolean(info.dev || info.devOptional),
        isDirect: directNames.has(name),
        lockfilePath: path,
      })
    );
  }
  return deps;
}

function parseYarnLock(path: string, content: string): SbomComponent[] {
  const deps: SbomComponent[] = [];
  const seen = new Set<string>();
  const isBerry = content.includes("__metadata:");

  if (isBerry) {
    const blockRe = /^"(@?[^@\n]+)@npm:[^"]*":\s*$/gm;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(content))) {
      const name = blockMatch[1]?.trim();
      if (!name || name === "__metadata") continue;
      const after = content.slice(
        blockMatch.index + blockMatch[0].length,
        blockMatch.index + blockMatch[0].length + 200
      );
      const verMatch = after.match(/^\s+version:\s+"?([^"\n\s]+)"?\s*$/m);
      if (!verMatch) continue;
      const key = `${name}@${verMatch[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push(
        createSbomComponent({
          name,
          version: verMatch[1],
          ecosystem: "npm",
          lockfilePath: path,
        })
      );
    }
  } else {
    const blockRe = /^"?(@?[^@\s][^@\n]*?)@[^:\n]+"?(?:,\s*"?@?[^@\s][^@\n]*?@[^:\n]+"?)*:\s*$/gm;
    const versionRe = /^\s+version\s+"([^"]+)"/gm;
    let blockMatch: RegExpExecArray | null;
    while ((blockMatch = blockRe.exec(content))) {
      const rawNames = blockMatch[0].replace(/:$/, "");
      const nameMatch = rawNames.match(/^"?(@?[^@\s]+)/);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      versionRe.lastIndex = blockMatch.index;
      const verMatch = versionRe.exec(content);
      if (!verMatch || verMatch.index - blockMatch.index >= 500) continue;
      const key = `${name}@${verMatch[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push(
        createSbomComponent({
          name,
          version: verMatch[1],
          ecosystem: "npm",
          lockfilePath: path,
        })
      );
    }
  }
  return deps;
}

function parsePnpmLock(path: string, content: string): SbomComponent[] {
  const deps: SbomComponent[] = [];
  const seen = new Set<string>();
  const patterns = [
    /^\s+\/?(@?[^@\s:][^@:]*?)@(\d[^:\s]*)\s*:/gm,
    /^\s+'(@?[^@'\s]+)@(\d[^']*)':\s*$/gm,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const name = match[1]?.replace(/^\//, "");
      const version = match[2];
      if (!name || !version) continue;
      const key = `${name}@${version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push(
        createSbomComponent({
          name,
          version,
          ecosystem: "npm",
          lockfilePath: path,
        })
      );
    }
  }
  return deps;
}

function parsePoetryLock(path: string, content: string): SbomComponent[] {
  const blocks = content.split(/^\[\[package\]\]\s*$/m).slice(1);
  const deps: SbomComponent[] = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
    const categoryMatch = block.match(/^category\s*=\s*"([^"]+)"/m);
    if (!nameMatch || !versionMatch) continue;
    deps.push(
      createSbomComponent({
        name: nameMatch[1],
        version: versionMatch[1],
        ecosystem: "pypi",
        isDev: categoryMatch?.[1] === "dev",
        lockfilePath: path,
      })
    );
  }
  return deps;
}

function parseCargoLock(path: string, content: string): SbomComponent[] {
  const blocks = content.split(/^\[\[package\]\]\s*$/m).slice(1);
  const deps: SbomComponent[] = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name\s*=\s*"([^"]+)"/m);
    const versionMatch = block.match(/^version\s*=\s*"([^"]+)"/m);
    if (!nameMatch || !versionMatch) continue;
    deps.push(
      createSbomComponent({
        name: nameMatch[1],
        version: versionMatch[1],
        ecosystem: "crates",
        lockfilePath: path,
      })
    );
  }
  return deps;
}

function parseGoSum(path: string, content: string): SbomComponent[] {
  const deps: SbomComponent[] = [];
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const [mod, rawVersion] = parts;
    const version = rawVersion.replace(/\/go\.mod$/, "");
    const key = `${mod}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deps.push(
      createSbomComponent({
        name: mod,
        version,
        ecosystem: "go",
        lockfilePath: path,
      })
    );
  }
  return deps;
}

function parsePackageJson(path: string, content: string): SbomComponent[] {
  const manifest = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const deps: SbomComponent[] = [];
  for (const [name, versionRange] of Object.entries(manifest.dependencies ?? {})) {
    deps.push(
      createSbomComponent({
        name,
        version: normalizeManifestVersion(versionRange),
        ecosystem: "npm",
        isDirect: true,
        lockfilePath: path,
      })
    );
  }
  for (const [name, versionRange] of Object.entries(manifest.devDependencies ?? {})) {
    deps.push(
      createSbomComponent({
        name,
        version: normalizeManifestVersion(versionRange),
        ecosystem: "npm",
        isDev: true,
        isDirect: true,
        lockfilePath: path,
      })
    );
  }
  for (const [name, versionRange] of Object.entries(manifest.optionalDependencies ?? {})) {
    deps.push(
      createSbomComponent({
        name,
        version: normalizeManifestVersion(versionRange),
        ecosystem: "npm",
        isDirect: true,
        lockfilePath: path,
      })
    );
  }
  return deps;
}

function normalizeManifestVersion(versionRange: string): string {
  const cleaned = versionRange.replace(/^[\^~>=<\s]+/, "").split(",")[0]?.trim();
  return cleaned || "unknown";
}

const LOCKFILE_PARSERS: Record<
  string,
  (path: string, content: string) => SbomComponent[]
> = {
  "package-lock.json": parsePackageLockJson,
  "yarn.lock": parseYarnLock,
  "pnpm-lock.yaml": parsePnpmLock,
  "poetry.lock": parsePoetryLock,
  "Cargo.lock": parseCargoLock,
  "go.sum": parseGoSum,
  "package.json": parsePackageJson,
};

export function parseLockfile(path: string, content: string): SbomComponent[] {
  const fileName = basename(path);
  const parser = LOCKFILE_PARSERS[fileName];
  if (!parser) return [];
  try {
    return parser(path, content);
  } catch {
    return [];
  }
}

export function discoverComponentsFromFiles(
  files: RepositoryFile[],
  options: { includeDev?: boolean } = {}
): SbomComponent[] {
  const includeDev = options.includeDev ?? true;
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  let components: SbomComponent[] = [];
  const lockfiles: string[] = [];
  const discoveredEcosystems = new Set<SbomEcosystem>();

  const lockfileNames = [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "poetry.lock",
    "Cargo.lock",
    "go.sum",
  ];

  for (const file of files) {
    const name = basename(file.path);
    if (!lockfileNames.includes(name)) continue;
    const parsed = parseLockfile(file.path, file.content);
    if (parsed.length === 0) continue;
    lockfiles.push(file.path);
    for (const component of parsed) {
      discoveredEcosystems.add(component.ecosystem);
    }
    components.push(...parsed);
  }

  if (components.length === 0) {
    for (const file of files) {
      if (basename(file.path) !== "package.json") continue;
      const parsed = parseLockfile(file.path, file.content);
      if (parsed.length > 0) {
        lockfiles.push(file.path);
        for (const component of parsed) {
          discoveredEcosystems.add(component.ecosystem);
        }
        components.push(...parsed);
      }
    }
  } else {
    const existing = new Set(components.map((component) => `${component.ecosystem}:${component.name}`));
    for (const file of files) {
      if (basename(file.path) !== "package.json") continue;
      const parsed = parseLockfile(file.path, file.content);
      for (const component of parsed) {
        const key = `${component.ecosystem}:${component.name}`;
        if (!existing.has(key)) {
          components.push(component);
          existing.add(key);
        }
      }
    }
  }

  if (!includeDev) {
    components = components.filter((component) => !component.isDev);
  }

  return dedupeComponents(components);
}

export function buildSbomSnapshot(
  files: RepositoryFile[],
  options: { includeDev?: boolean } = {}
) {
  const components = discoverComponentsFromFiles(files, options);
  const pkg = files.find((file) => basename(file.path) === "package.json");
  let projectName = "unknown";
  let projectVersion = "0.0.0";
  if (pkg) {
    try {
      const manifest = JSON.parse(pkg.content) as { name?: string; version?: string };
      projectName = manifest.name ?? projectName;
      projectVersion = manifest.version ?? projectVersion;
    } catch {
      // ignore malformed package.json
    }
  }

  const lockfiles = [
    ...new Set(
      components
        .map((component) => component.lockfilePath)
        .filter((value): value is string => Boolean(value))
    ),
  ];

  return {
    components,
    metadata: {
      name: projectName,
      version: projectVersion,
      ecosystems: [...new Set(components.map((component) => component.ecosystem))],
      total: components.length,
      direct: components.filter((component) => component.isDirect).length,
      dev: components.filter((component) => component.isDev).length,
      lockfiles,
    },
  };
}

export function findLineNumber(content: string, needle: string): number {
  const index = content.indexOf(needle);
  if (index < 0) return 1;
  return content.slice(0, index).split("\n").length;
}

export function getFileContent(files: RepositoryFile[], path: string | null | undefined): string | null {
  if (!path) return null;
  return files.find((file) => file.path === path)?.content ?? null;
}
