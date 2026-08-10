import "server-only";

import type { DynamicTargetFixtures } from "@/server/attack-simulation/dynamic/authorized-target";
import type { StaticFindingInput } from "./correlate-findings";
import { STATIC_RULE_TO_ADAPTERS } from "./select-attacks-from-findings";

type FixturePathKey = keyof NonNullable<DynamicTargetFixtures["paths"]>;

const ADAPTER_PRIMARY_PATH_KEYS: Readonly<Record<string, readonly FixturePathKey[]>> = {
  "unauthenticated-endpoint": ["unauthenticated"],
  "idor-cross-tenant": ["idorResourceB"],
  "rate-limit-brute-force": ["rateLimitVulnerable"],
  "webhook-signature-bypass": ["webhook"],
  "idempotency-replay": ["idempotent"],
  "mass-assignment-probe": ["massAssignment"],
  "privilege-escalation": ["privilegeEscalation"],
  "security-headers-probe": ["securityHeaders"],
  "injection-probe-safe": ["injectionEcho"],
  "ssrf-probe-safe": ["ssrf"],
  "cors-misconfiguration": ["cors"],
};

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function dynamicSegmentToParam(segment: string): string | null {
  if (!segment.startsWith("[") || !segment.endsWith("]")) return segment;
  let inner = segment.slice(1, -1);
  if (inner.startsWith("[...") && inner.endsWith("]")) {
    inner = inner.slice(1, -1);
  }
  if (inner.startsWith("...")) return `{${inner.slice(3)}}`;
  return `{${inner}}`;
}

function segmentsToRoutePath(segments: string[]): string | null {
  const routeParts = segments
    .filter((segment) => segment.length > 0)
    .filter((segment) => !segment.startsWith("(") && !segment.endsWith(")"))
    .filter((segment) => !segment.startsWith("@"))
    .map((segment) => dynamicSegmentToParam(segment))
    .filter((segment): segment is string => Boolean(segment));

  if (routeParts.length === 0) return null;
  return `/${routeParts.join("/")}`;
}

/** Conservative HTTP route inference from repository file paths (Next.js conventions). */
export function inferHttpRouteFromFilePath(filePath: string | null | undefined): string | null {
  if (!filePath?.trim()) return null;
  const normalized = normalizeSlashes(filePath.trim());

  const appPatterns: RegExp[] = [
    /(?:^|\/)app\/(.+?)\/route\.(?:tsx?|jsx?|mjs)$/i,
    /(?:^|\/)src\/app\/(.+?)\/route\.(?:tsx?|jsx?|mjs)$/i,
  ];
  for (const pattern of appPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const route = segmentsToRoutePath(match[1].replace(/\/route$/i, "").split("/"));
    if (route) return route;
  }

  const pagesApiPatterns: RegExp[] = [
    /(?:^|\/)pages\/api\/(.+?)\.(?:tsx?|jsx?)$/i,
    /(?:^|\/)src\/pages\/api\/(.+?)\.(?:tsx?|jsx?)$/i,
  ];
  for (const pattern of pagesApiPatterns) {
    const match = normalized.match(pattern);
    if (!match?.[1]) continue;
    const route = segmentsToRoutePath(`api/${match[1]}`.split("/"));
    if (route) return route;
  }

  return null;
}

function inferSafePageRoute(filePath: string | null | undefined): string | null {
  if (!filePath?.trim()) return null;
  const normalized = normalizeSlashes(filePath.trim());
  const patterns: RegExp[] = [
    /(?:^|\/)app\/(.*?)page\.(?:tsx?|jsx?|mjs)$/i,
    /(?:^|\/)src\/app\/(.*?)page\.(?:tsx?|jsx?|mjs)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const route = segmentsToRoutePath((match[1] ?? "").split("/"));
    return route ?? "/";
  }
  return null;
}

export type RouteMappingResult =
  | {
      testable: true;
      route: string;
      fixtures: DynamicTargetFixtures;
    }
  | {
      testable: false;
      reason: string;
    };

export function mapFindingToDynamicFixtures(input: {
  finding: StaticFindingInput;
  adapterId: string;
}): RouteMappingResult {
  const route =
    inferHttpRouteFromFilePath(input.finding.filePath) ??
    (input.adapterId === "security-headers-probe"
      ? inferSafePageRoute(input.finding.filePath)
      : null);
  if (!route) {
    return {
      testable: false,
      reason: "SequrAI could not determine a safe application endpoint for this finding.",
    };
  }

  const keys = ADAPTER_PRIMARY_PATH_KEYS[input.adapterId];
  if (!keys || keys.length === 0) {
    return {
      testable: false,
      reason: "Dynamic verification could not safely determine the affected endpoint.",
    };
  }

  const paths: NonNullable<DynamicTargetFixtures["paths"]> = {};
  for (const key of keys) {
    paths[key] = route;
  }

  if (input.adapterId === "unauthenticated-endpoint") {
    paths.authenticated = route;
  }

  return {
    testable: true,
    route,
    fixtures: { paths },
  };
}

export function adaptersForFinding(finding: StaticFindingInput): string[] {
  const ruleId = (finding.ruleId ?? "").toLowerCase();
  return [...(STATIC_RULE_TO_ADAPTERS[ruleId] ?? [])];
}

export function isAdapterMappableForFinding(input: {
  finding: StaticFindingInput;
  adapterId: string;
}): boolean {
  return mapFindingToDynamicFixtures(input).testable;
}
