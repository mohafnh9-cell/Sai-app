import { loadNamespace } from "./load-messages";
import { createTranslator } from "./translate";
import type { AppLocale, MessageNamespace, Translator } from "./types";

export function namespaceTranslator(
  locale: AppLocale,
  namespace: MessageNamespace
): Translator {
  const messages = { [namespace]: loadNamespace(locale, namespace) };
  const t = createTranslator(messages, locale);
  return (key, params) => t(`${namespace}.${key}`, params);
}

export function reviewProgressMessage(locale: AppLocale, key: string): string {
  return namespaceTranslator(locale, "reviewProgress")(key);
}

/** Legacy English progress strings stored before i18n keys were adopted. */
const LEGACY_PROGRESS_MESSAGE_MAP: Record<string, string> = {
  "Review queued": "queued",
  "Fetching repository metadata": "fetchingRepository",
  "Analyzing repository files": "analyzingFiles",
  "Running deterministic security rules": "runningRules",
  "Running incremental security rules": "runningIncrementalRules",
  "Calculating security score": "calculatingScore",
  "Scan completed": "completed",
  "Incremental scan completed": "incrementalCompleted",
  "Production Verdict could not be saved": "verdictSaveFailed",
  "Scan failed": "failed",
  "No scannable file changes detected": "noChanges",
  "Review could not be executed": "reviewCouldNotExecute",
  "Connecting to repository": "connectingRepository",
  "Production review cancelled": "cancelled",
  "Cancelling production review": "cancelling",
  "Review stopped — repository moved to a newer commit": "superseded",
  "Review timed out and was recovered": "timedOut",
  "Automatic production review queued": "automaticQueued",
  "Scan queued by GitHub automation": "githubQueued",
  "Scan job infrastructure is not available": "infrastructureUnavailable",
  "Could not enqueue Production Review worker": "enqueueFailed",
  "Review already completed for this commit — reusing existing results.": "reuseCompleted",
  "Review already in progress for this commit — resuming existing run.": "resumeActive",
  "Production Review requested from MCP": "mcpReviewRequested",
};

export function translateStoredProgressMessage(
  locale: AppLocale,
  message: string | null | undefined
): string {
  if (!message) return "";
  const t = namespaceTranslator(locale, "reviewProgress");
  const direct = t(message);
  if (direct !== `reviewProgress.${message}`) return direct;
  const legacyKey = LEGACY_PROGRESS_MESSAGE_MAP[message];
  if (legacyKey) return t(legacyKey);
  return message;
}
