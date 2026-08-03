import type { StackProfile } from "@/features/security-scanner/types";
import type { ProjectType } from "@/brain/evidence-finding/project-context";

export type PrimaryFramework =
  | "nextjs"
  | "react_spa"
  | "vite"
  | "vue"
  | "angular"
  | "express"
  | "fastify"
  | "nest"
  | "rails"
  | "django"
  | "spring"
  | "aspnet"
  | "static"
  | "unknown";

export const CONFIDENCE_FINDING_THRESHOLD = 0.7;

export type RepositoryModel = {
  version: 1;
  framework: PrimaryFramework;
  stack: StackProfile;
  projectType: ProjectType;
  paths: string[];
  capabilities: {
    hasNextJs: boolean;
    hasReact: boolean;
    hasVite: boolean;
    hasExpress: boolean;
    hasFastify: boolean;
    hasNest: boolean;
    hasAppRouter: boolean;
    hasPagesRouter: boolean;
    hasAppApi: boolean;
    hasPagesApi: boolean;
    hasExpressRoutes: boolean;
    hasMiddleware: boolean;
    hasAuthLibrary: boolean;
    hasJwtOrSession: boolean;
    hasDatabase: boolean;
    hasOrm: boolean;
    hasApiSurface: boolean;
    hasProtectedRoutes: boolean;
    hasPublicPagesOnly: boolean;
    hasWebhookHandlers: boolean;
    hasLlmIntegration: boolean;
  };
  routeFiles: string[];
  authFiles: string[];
  publicPages: string[];
  privatePages: string[];
};

export type FindingClassification =
  | "confirmed_finding"
  | "potential_observation"
  | "production_blocker"
  | "no_evidence";

export type RepositoryModelSummary = Pick<
  RepositoryModel,
  "framework" | "projectType" | "capabilities" | "paths" | "routeFiles" | "authFiles"
>;

export function toRepositoryModelSummary(model: RepositoryModel): RepositoryModelSummary {
  return {
    framework: model.framework,
    projectType: model.projectType,
    capabilities: model.capabilities,
    paths: model.paths,
    routeFiles: model.routeFiles,
    authFiles: model.authFiles,
  };
}

export function repositoryModelFromSummary(
  summary: RepositoryModelSummary,
  stack: StackProfile
): RepositoryModel {
  return {
    version: 1,
    stack,
    framework: summary.framework,
    projectType: summary.projectType,
    paths: summary.paths,
    capabilities: summary.capabilities,
    routeFiles: summary.routeFiles,
    authFiles: summary.authFiles,
    publicPages: summary.paths.filter((path) => /^app\/page\.[jt]sx?$/.test(path)),
    privatePages: summary.paths.filter((path) => /dashboard|settings|admin/.test(path)),
  };
}
