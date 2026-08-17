import type { NormalizedFile } from "../types";

const USE_CLIENT_DIRECTIVE = /^\s*["']use client["'];?/m;
const SERVER_ONLY_IMPORT = /import\s+["']server-only["']/;
const NEXT_API_ROUTE = /(?:^|\/)app\/api\/.*\/route\.[jt]sx?$/i;
const SERVER_DIRECTORY = /(?:^|\/)server\//;
const NODEJS_RUNTIME = /export\s+const\s+runtime\s*=\s*["']nodejs["']/;
const SERVICE_ROLE_REFERENCE = /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i;

/** References Supabase service-role credentials in source text. */
export function referencesSupabaseServiceRole(file: Pick<NormalizedFile, "content">): boolean {
  return SERVICE_ROLE_REFERENCE.test(file.content);
}

/** Module is explicitly server-only (App Router API route, server/ tree, etc.). */
export function isExplicitlyServerModule(file: NormalizedFile): boolean {
  if (SERVER_ONLY_IMPORT.test(file.content)) return true;
  if (NEXT_API_ROUTE.test(file.path)) return true;
  if (SERVER_DIRECTORY.test(file.path)) return true;
  if (NODEJS_RUNTIME.test(file.content)) return true;
  return false;
}

/** Module is marked to execute in the browser (client component boundary). */
export function isClientExecutedModule(file: Pick<NormalizedFile, "content">): boolean {
  return USE_CLIENT_DIRECTIVE.test(file.content);
}

/**
 * True when a service-role reference likely reaches client-executed code.
 * Server-side process.env access in API routes and server/ modules is excluded.
 */
export function isSupabaseServiceRoleClientExposure(file: NormalizedFile): boolean {
  if (!referencesSupabaseServiceRole(file)) return false;
  if (isExplicitlyServerModule(file)) return false;
  return isClientExecutedModule(file);
}

export function firstServiceRoleReferenceLine(file: NormalizedFile): number {
  const index = file.lines.findIndex((line) => SERVICE_ROLE_REFERENCE.test(line));
  return index >= 0 ? index + 1 : 1;
}
