import "server-only";

import type { McpAuthContext } from "../auth";
import { McpError } from "../auth";
import { MCP_PUBLIC_TOOL_NAMES } from "../tool-definitions";

export const MCP_SCOPE_STATUS_READ = "mcp:status:read";
export const MCP_SCOPE_DISCOVER_READ = "mcp:discover:read";
export const MCP_SCOPE_FIX_READ = "mcp:fix:read";
export const MCP_SCOPE_REVIEW_RUN = "mcp:review:run";
export const MCP_SCOPE_AUDIT_RUN = "mcp:audit:run";
export const MCP_SCOPE_TARGET_AUTHORIZE = "mcp:target:authorize";

export const ALL_MCP_SCOPES = [
  MCP_SCOPE_STATUS_READ,
  MCP_SCOPE_DISCOVER_READ,
  MCP_SCOPE_FIX_READ,
  MCP_SCOPE_REVIEW_RUN,
  MCP_SCOPE_AUDIT_RUN,
  MCP_SCOPE_TARGET_AUTHORIZE,
] as const;

export type McpScope = (typeof ALL_MCP_SCOPES)[number];

/** Single source of truth: tool → required scope. */
export const TOOL_REQUIRED_SCOPE: Record<string, McpScope> = {
  can_i_deploy: MCP_SCOPE_STATUS_READ,
  what_changed: MCP_SCOPE_STATUS_READ,
  production_history: MCP_SCOPE_STATUS_READ,
  discover_application: MCP_SCOPE_DISCOVER_READ,
  safe_fix: MCP_SCOPE_FIX_READ,
  review_now: MCP_SCOPE_REVIEW_RUN,
  cancel_review: MCP_SCOPE_REVIEW_RUN,
  full_product_audit: MCP_SCOPE_AUDIT_RUN,
  authorize_dynamic_target: MCP_SCOPE_TARGET_AUTHORIZE,
};

export const SCOPE_DESCRIPTIONS: Record<McpScope, { en: string; es: string }> = {
  [MCP_SCOPE_STATUS_READ]: {
    en: "Read Production Verdict status, changes, and history",
    es: "Consultar estado del Production Verdict, cambios e historial",
  },
  [MCP_SCOPE_DISCOVER_READ]: {
    en: "Discover application architecture from connected repositories",
    es: "Descubrir arquitectura de aplicaciones en repositorios conectados",
  },
  [MCP_SCOPE_FIX_READ]: {
    en: "Generate Safe Fix prompts for identified blockers",
    es: "Generar prompts Safe Fix para blockers identificados",
  },
  [MCP_SCOPE_REVIEW_RUN]: {
    en: "Run and cancel production reviews on GitHub repositories",
    es: "Ejecutar y cancelar reviews de producción en repositorios GitHub",
  },
  [MCP_SCOPE_AUDIT_RUN]: {
    en: "Run full product audits on GitHub repositories",
    es: "Ejecutar auditorías completas en repositorios GitHub",
  },
  [MCP_SCOPE_TARGET_AUTHORIZE]: {
    en: "Authorize dynamic verification targets for security tests",
    es: "Autorizar targets dinámicos para pruebas de seguridad",
  },
};

export function parseScopeString(scope: string | null | undefined): McpScope[] {
  if (!scope?.trim()) return [...ALL_MCP_SCOPES];
  const requested = scope.trim().split(/\s+/);
  const invalid = requested.filter((s) => !ALL_MCP_SCOPES.includes(s as McpScope));
  if (invalid.length > 0) {
    return [];
  }
  return requested as McpScope[];
}

export function validateRequestedScopes(scopes: McpScope[]): void {
  if (scopes.length === 0) {
    throw new McpError(400, "invalid_scope", "No valid scopes requested");
  }
}

export function scopesInclude(granted: string[], required: McpScope): boolean {
  return granted.includes(required);
}

export function assertToolScope(ctx: McpAuthContext, toolName: string): void {
  if (!MCP_PUBLIC_TOOL_NAMES.includes(toolName)) {
    throw new McpError(404, "unknown_tool", `Unknown tool: ${toolName}`);
  }

  if (ctx.authType === "api_key") {
    return;
  }

  const required = TOOL_REQUIRED_SCOPE[toolName];
  if (!required) {
    throw new McpError(404, "unknown_tool", `Unknown tool: ${toolName}`);
  }

  if (!scopesInclude(ctx.scopes, required)) {
    throw new McpError(403, "insufficient_scope", "Insufficient scope for this tool", {
      requiredScope: required,
    });
  }
}

export function formatScopeString(scopes: string[]): string {
  return scopes.join(" ");
}
