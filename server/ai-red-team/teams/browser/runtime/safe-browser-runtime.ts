import type { AttackAuthorizationRecord } from "../../../authorization";
import { isOriginAllowed, isDestructiveActionHint } from "../../../authorization";
import type { BrowserTeamBudget } from "../browser-team.config";
import { ExecutionBudget } from "./execution-budget";

export type SafeNavigationResult = {
  url: string;
  status: number | null;
  headers: Record<string, string>;
  ok: boolean;
};

export type SafeBrowserPageSnapshot = {
  url: string;
  title: string;
  links: string[];
  forms: Array<{ action: string; method: string; fields: string[] }>;
  consoleEvents: Array<{ level: string; text: string }>;
  pageErrors: string[];
  storageKeys: { local: string[]; session: string[] };
};

export type SafeBrowserRuntime = {
  readonly allowedOrigin: string;
  goto(path: string): Promise<SafeNavigationResult>;
  snapshot(): Promise<SafeBrowserPageSnapshot>;
  clickSafe(selector: string): Promise<{ ok: boolean; reason?: string }>;
  close(): Promise<void>;
};

export type SafeBrowserRuntimeFactory = {
  create(input: {
    targetUrl: string;
    authorization: AttackAuthorizationRecord;
    budget: ExecutionBudget;
    signal?: AbortSignal;
  }): Promise<SafeBrowserRuntime>;
};

export function assertSafeNavigation(
  url: string,
  authorization: AttackAuthorizationRecord
): void {
  if (!isOriginAllowed(url, authorization.targetOrigin, authorization.redirectAllowlist)) {
    throw new Error(`Navigation blocked: external origin ${url}`);
  }
}

export function assertSafeInteraction(input: {
  path?: string;
  method?: string;
  label?: string;
}): void {
  if (isDestructiveActionHint(input)) {
    throw new Error("Interaction blocked: potentially destructive action");
  }
}

export function budgetFromAuthorization(authorization: AttackAuthorizationRecord): BrowserTeamBudget {
  return {
    maxDurationMs: authorization.maxDurationSeconds * 1000,
    maxRoutes: 40,
    maxDepth: 4,
    maxNavigations: 80,
    maxActions: 120,
    maxRequests: authorization.maxRequestBudget,
    maxScreenshots: 12,
  };
}
