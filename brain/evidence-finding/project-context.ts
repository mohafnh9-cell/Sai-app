export type ProjectType =
  | "marketing_website"
  | "documentation"
  | "landing_page"
  | "dashboard"
  | "internal_tool"
  | "saas_application"
  | "api_service"
  | "admin_panel"
  | "unknown";

export type ProjectContext = {
  projectType: ProjectType;
  hasMiddleware: boolean;
  hasAppRouter: boolean;
  hasAppApi: boolean;
  hasPagesApi: boolean;
  hasAuthLib: boolean;
  hasSupabaseAuth: boolean;
  hasNextAuth: boolean;
  existingPaths: string[];
  recommendedAuthPaths: string[];
};

const MARKETING_HINTS = [
  /^app\/page\.[jt]sx?$/,
  /^pages\/index\.[jt]sx?$/,
  /^app\/\(marketing\)/,
  /^components\/(hero|landing|marketing)/i,
];

const API_HINTS = [/^app\/api\//, /^pages\/api\//, /^server\/.*\/route\.[jt]s$/];
const AUTH_HINTS = [/next-auth/, /clerk/, /supabase.*auth/i, /lucia/, /better-auth/];

export function analyzeProjectContext(filePaths: readonly string[]): ProjectContext {
  const paths = [...filePaths];
  const normalized = paths.map((path) => path.replace(/\\/g, "/"));

  const hasMiddleware = normalized.some((path) => /(?:^|\/)middleware\.[jt]s$/.test(path));
  const hasAppRouter = normalized.some((path) => /^app\//.test(path));
  const hasAppApi = normalized.some((path) => /^app\/api\//.test(path));
  const hasPagesApi = normalized.some((path) => /^pages\/api\//.test(path));
  const hasAuthLib = normalized.some((path) =>
    /(?:auth|session|login|sign-in|signin)/i.test(path)
  );
  const hasSupabaseAuth = normalized.some((path) =>
    /(?:supabase|createClient|auth\.ts|auth\.js)/i.test(path)
  );
  const hasNextAuth = normalized.some((path) => /next-auth|NextAuth/i.test(path));

  const apiCount = normalized.filter((path) => API_HINTS.some((re) => re.test(path))).length;
  const marketingCount = normalized.filter((path) =>
    MARKETING_HINTS.some((re) => re.test(path))
  ).length;

  let projectType: ProjectType = "unknown";
  if (apiCount >= 3 && hasAppApi) {
    projectType = "saas_application";
  } else if (apiCount >= 5 && !hasAppRouter) {
    projectType = "api_service";
  } else if (/admin/i.test(normalized.join(" "))) {
    projectType = "admin_panel";
  } else if (marketingCount >= 2 && apiCount === 0) {
    projectType = "marketing_website";
  } else if (/docs|documentation/i.test(normalized.join(" "))) {
    projectType = "documentation";
  } else if (hasAppRouter && apiCount > 0) {
    projectType = "dashboard";
  } else if (marketingCount >= 1 && apiCount <= 1) {
    projectType = "landing_page";
  }

  const recommendedAuthPaths: string[] = [];
  if (hasMiddleware) recommendedAuthPaths.push("middleware.ts");
  if (hasAppApi) recommendedAuthPaths.push("app/api/**/route.ts");
  if (hasPagesApi) recommendedAuthPaths.push("pages/api/**/*.ts");
  if (hasSupabaseAuth) recommendedAuthPaths.push("lib/supabase/server.ts", "utils/supabase/server.ts");
  if (hasNextAuth) recommendedAuthPaths.push("app/api/auth/[...nextauth]/route.ts", "pages/api/auth/[...nextauth].ts");
  if (recommendedAuthPaths.length === 0 && hasAuthLib) {
    recommendedAuthPaths.push("server/**/auth/**", "lib/auth/**");
  }

  return {
    projectType,
    hasMiddleware,
    hasAppRouter,
    hasAppApi,
    hasPagesApi,
    hasAuthLib,
    hasSupabaseAuth,
    hasNextAuth,
    existingPaths: normalized,
    recommendedAuthPaths,
  };
}

export function resolveExistingAffectedFiles(
  candidates: readonly string[],
  context: ProjectContext
): string[] {
  const existing = new Set(context.existingPaths);
  const resolved: string[] = [];

  for (const candidate of candidates) {
    if (candidate.includes("**")) {
      const prefix = candidate.replace(/\*\*.*$/, "").replace(/\*$/, "");
      const matches = context.existingPaths.filter((path) => path.startsWith(prefix));
      if (matches.length > 0) {
        resolved.push(...matches.slice(0, 3));
        continue;
      }
    }
    if (existing.has(candidate)) {
      resolved.push(candidate);
      continue;
    }
    const basename = candidate.split("/").pop();
    if (basename) {
      const match = context.existingPaths.find((path) => path.endsWith(basename));
      if (match) resolved.push(match);
    }
  }

  return [...new Set(resolved)].slice(0, 5);
}

export function projectAwareRecommendation(input: {
  genericRecommendation: string;
  context: ProjectContext;
  adapterId?: string;
}): string {
  const { context, genericRecommendation, adapterId } = input;

  if (/middleware/i.test(genericRecommendation) && !context.hasMiddleware) {
    if (context.hasAppApi) {
      return genericRecommendation.replace(/middleware\.ts/gi, "app/api route handlers");
    }
    if (context.hasPagesApi) {
      return genericRecommendation.replace(/middleware\.ts/gi, "pages/api handlers");
    }
    return `Add server-side authentication checks in existing route handlers (${context.recommendedAuthPaths.join(", ") || "server entry points"}). Do not reference middleware.ts because this project does not include one.`;
  }

  if (/app\/api/i.test(genericRecommendation) && !context.hasAppApi && context.hasPagesApi) {
    return genericRecommendation.replace(/app\/api/g, "pages/api");
  }

  if (adapterId === "unauthenticated-endpoint" && context.projectType === "marketing_website") {
    return "Verify whether this route is intentionally public for a marketing site. If it must stay public, document the exception and add rate limiting.";
  }

  return genericRecommendation;
}
