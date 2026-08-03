import type { NormalizedFile, StackProfile } from "./types";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".ts": "TypeScript", ".tsx": "TypeScript", ".sql": "SQL",
};

export function detectStack(files: NormalizedFile[]): StackProfile {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const services = new Set<string>();
  const packageManagers = new Set<string>();
  let dependencies: Record<string, string> = {};

  const packageFile = files.find((file) => file.path === "package.json");
  let packages = new Set<string>();
  if (packageFile) {
    try {
      const manifest = JSON.parse(packageFile.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        engines?: Record<string, string>;
      };
      packages = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
      ]);
      dependencies = Object.fromEntries(
        Object.entries({
          ...(manifest.dependencies ?? {}),
          ...(manifest.devDependencies ?? {}),
        }).map(([name, version]) => [name, safeDependencyVersion(version)])
      );
      if (manifest.engines?.node || Object.keys(manifest.scripts ?? {}).length > 0) {
        frameworks.add("Node.js");
      }
    } catch {
      // Invalid package.json is ignored; stack detection must not fail a scan.
    }
  }

  const hasPackage = (name: string) => packages.has(name);
  if (hasPackage("next")) frameworks.add("Next.js");
  if (hasPackage("react") || hasPackage("react-dom")) frameworks.add("React");
  if (hasPackage("express")) frameworks.add("Express");
  if (hasPackage("vite")) frameworks.add("Vite");
  if (hasPackage("vue")) frameworks.add("Vue");
  if (hasPackage("@angular/core")) frameworks.add("Angular");
  if (hasPackage("@nestjs/core")) frameworks.add("NestJS");
  if (hasPackage("fastify")) frameworks.add("Fastify");
  if (hasPackage("@remix-run/react")) frameworks.add("Remix");
  if ([...packages].some((name) => name.startsWith("@supabase/"))) services.add("Supabase");
  if (hasPackage("firebase") || hasPackage("firebase-admin")) services.add("Firebase");
  if (hasPackage("@prisma/client") || hasPackage("prisma")) services.add("Prisma");
  if (hasPackage("pg") || hasPackage("postgres")) services.add("PostgreSQL");
  if (hasPackage("mongodb") || hasPackage("mongoose")) services.add("MongoDB");

  for (const file of files) {
    const language = LANGUAGE_BY_EXTENSION[file.extension];
    if (language) languages.add(language);
    if (/^next\.config\.[cm]?[jt]s$/.test(file.path)) frameworks.add("Next.js");
    if (/^vite\.config\.(?:[cm]?[jt]s|mts)$/.test(file.path)) frameworks.add("Vite");
    if (/^angular\.json$/.test(file.path)) frameworks.add("Angular");
    if (file.extension === ".jsx" || file.extension === ".tsx") frameworks.add("React");
    if (file.path.endsWith(".prisma")) services.add("Prisma");
    if (/^(?:Dockerfile|docker-compose\.ya?ml)$/.test(file.path)) services.add("Docker");
    if (file.path === "vercel.json") services.add("Vercel");
    if (/(?:^|\/)(?:firestore|storage)\.rules$/.test(file.path)) services.add("Firebase");
    if (/supabase\/migrations\/.+\.sql$/.test(file.path)) services.add("Supabase");
    if (file.path === "package-lock.json") packageManagers.add("npm");
    if (file.path === "pnpm-lock.yaml") packageManagers.add("pnpm");
    if (file.path === "yarn.lock") packageManagers.add("Yarn");
    if (file.path === "bun.lockb" || file.path === "bun.lock") packageManagers.add("Bun");
  }

  const sorted = (values: Set<string>) => [...values].sort();
  return {
    languages: sorted(languages),
    frameworks: sorted(frameworks),
    services: sorted(services),
    packageManagers: sorted(packageManagers),
    dependencies: Object.fromEntries(
      Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right))
    ),
  };
}

function safeDependencyVersion(version: string): string {
  if (/^(?:https?:|git(?:\+|:)|github:)/i.test(version) || /:\/\/[^/\s]+@/.test(version)) {
    return "[remote-reference]";
  }
  if (/^(?:workspace:|file:|link:)/i.test(version)) return "[local-reference]";
  return /^[~^<>=*0-9xXv.\s|/-]{1,80}$/.test(version)
    ? version
    : "[non-registry-reference]";
}
