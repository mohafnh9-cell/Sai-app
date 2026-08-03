import type { NormalizedFile, StackProfile } from "@/features/security-scanner/types";
import { analyzeProjectContext } from "@/brain/evidence-finding/project-context";
import type { PrimaryFramework, RepositoryModel, RepositoryModelSummary } from "./schema";

const ROUTE_PATTERNS = [
  /^app\/api\/.+\/route\.[jt]s$/,
  /^pages\/api\/.+\.[jt]s$/,
  /^server\/routes?\/.+\.[jt]s$/,
  /^src\/routes?\/.+\.[jt]s$/,
  /^routes?\/.+\.[jt]s$/,
];

const AUTH_FILE_PATTERNS = [
  /(?:^|\/)middleware\.[jt]s$/,
  /(?:^|\/)auth\.[jt]s$/,
  /(?:^|\/)session\.[jt]s$/,
  /next-auth/i,
  /clerk/i,
  /lucia/i,
  /better-auth/i,
  /supabase.*auth/i,
];

const PUBLIC_PAGE_PATTERNS = [
  /^app\/page\.[jt]sx?$/,
  /^pages\/index\.[jt]sx?$/,
  /^app\/\(marketing\)/,
  /^public\//,
];

const PRIVATE_PAGE_PATTERNS = [
  /^app\/\(dashboard\)/,
  /^app\/dashboard/,
  /^pages\/dashboard/,
  /^app\/settings/,
];

export function detectPrimaryFramework(stack: StackProfile, paths: readonly string[]): PrimaryFramework {
  const deps = Object.keys(stack.dependencies ?? {});
  const has = (name: string) => deps.includes(name) || stack.frameworks.includes(name);

  if (has("next") || paths.some((p) => /^next\.config\./.test(p))) return "nextjs";
  if (has("vite") || paths.some((p) => p === "vite.config.ts" || p === "vite.config.js")) return "vite";
  if (has("@angular/core")) return "angular";
  if (has("vue")) return "vue";
  if (has("@nestjs/core")) return "nest";
  if (has("fastify")) return "fastify";
  if (has("express")) return "express";
  if (has("react") || has("react-dom")) return "react_spa";
  if (paths.some((p) => /Gemfile/.test(p))) return "rails";
  if (paths.some((p) => /manage\.py/.test(p))) return "django";
  if (paths.some((p) => /\.csproj$/.test(p))) return "aspnet";
  if (paths.some((p) => /pom\.xml/.test(p) || /build\.gradle/.test(p))) return "spring";
  if (paths.length <= 5 && paths.every((p) => /\.html?$/.test(p))) return "static";
  return "unknown";
}

export function buildRepositoryModel(files: readonly NormalizedFile[], stack: StackProfile): RepositoryModel {
  const paths = files.map((file) => file.path.replace(/\\/g, "/"));
  const projectContext = analyzeProjectContext(paths);
  const framework = detectPrimaryFramework(stack, paths);

  const routeFiles = paths.filter((path) => ROUTE_PATTERNS.some((re) => re.test(path)));
  const authFiles = paths.filter((path) => AUTH_FILE_PATTERNS.some((re) => re.test(path)));
  const publicPages = paths.filter((path) => PUBLIC_PAGE_PATTERNS.some((re) => re.test(path)));
  const privatePages = paths.filter((path) => PRIVATE_PAGE_PATTERNS.some((re) => re.test(path)));

  const hasAppApi = paths.some((p) => /^app\/api\//.test(p));
  const hasPagesApi = paths.some((p) => /^pages\/api\//.test(p));
  const hasExpressRoutes = paths.some((p) =>
    /^(?:server\/|src\/)?(?:routes?|api)\/.+\.[jt]s$/.test(p)
  );
  const hasApiSurface = routeFiles.length > 0 || hasAppApi || hasPagesApi || hasExpressRoutes;
  const hasAuthLibrary =
    projectContext.hasAuthLib ||
    projectContext.hasNextAuth ||
    projectContext.hasSupabaseAuth ||
    authFiles.length > 0;
  const hasJwtOrSession = files.some((file) =>
    /jwt|session|getServerSession|getUser|auth\.getUser/i.test(file.content)
  );
  const hasDatabase = stack.services.some((s) =>
    ["PostgreSQL", "MongoDB", "Supabase", "Prisma", "Firebase"].includes(s)
  );
  const hasOrm = stack.services.some((s) => ["Prisma"].includes(s));
  const hasProtectedRoutes = privatePages.length > 0 || paths.some((p) => /\/dashboard|\/settings|\/admin/.test(p));
  const hasPublicPagesOnly =
    projectContext.projectType === "marketing_website" ||
    projectContext.projectType === "landing_page" ||
    (publicPages.length > 0 && !hasApiSurface && !hasProtectedRoutes);
  const hasWebhookHandlers = paths.some((p) => /webhook/i.test(p));
  const hasLlmIntegration =
    stack.dependencies?.openai != null ||
    stack.dependencies?.["@anthropic-ai/sdk"] != null ||
    paths.some((p) => /\/rag\/|\/agents\/|\/llm\//.test(p));

  return {
    version: 1,
    framework,
    stack,
    projectType: projectContext.projectType,
    paths,
    capabilities: {
      hasNextJs: framework === "nextjs",
      hasReact: stack.frameworks.includes("React"),
      hasVite: framework === "vite",
      hasExpress: framework === "express",
      hasFastify: framework === "fastify",
      hasNest: framework === "nest",
      hasAppRouter: projectContext.hasAppRouter,
      hasPagesRouter: paths.some((p) => /^pages\//.test(p)),
      hasAppApi,
      hasPagesApi,
      hasExpressRoutes,
      hasMiddleware: projectContext.hasMiddleware,
      hasAuthLibrary,
      hasJwtOrSession,
      hasDatabase,
      hasOrm,
      hasApiSurface,
      hasProtectedRoutes,
      hasPublicPagesOnly,
      hasWebhookHandlers,
      hasLlmIntegration,
    },
    routeFiles,
    authFiles,
    publicPages,
    privatePages,
  };
}
