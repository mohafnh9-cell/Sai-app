/**
 * Auto-Security MVP -- deterministic security-relevance classification.
 *
 * Not AI, not semantic: a small, explicit pattern list, per the master
 * prompt's own preference ("a deterministic classifier is preferred for
 * this 10-day pilot") and bias ("when uncertain whether a change is
 * security-relevant, TRIGGER THE REVIEW... but do not trigger a review for
 * every trivial event"). Implementation of that bias: a change is treated
 * as NOT security-relevant only when every changed path matches the small,
 * explicit LOW-relevance list (docs, comments-only files, pure styling,
 * lockfile-adjacent noise excluded below); everything else -- including any
 * file this classifier doesn't specifically recognize -- is treated as
 * relevant. This intentionally over-triggers rather than under-triggers.
 */

const HIGH_RELEVANCE_PATTERNS: RegExp[] = [
  /\bauth\b/i,
  /\blogin\b/i,
  /\bsession\b/i,
  /middleware\.[jt]sx?$/i,
  /\bauthz\b|\bauthoriz/i,
  /\b(permission|role|rbac|acl)s?\b/i,
  /(^|\/)(app|pages)\/api\//i,
  /\/route\.[jt]sx?$/i,
  /(^|\/)server\//i,
  /(^|\/)(db|database|prisma|migrations)\//i,
  /\.sql$/i,
  /\brls\b|row.level.security/i,
  /security[._-]?config/i,
  /\.env(\..+)?$/i,
  /\bsecrets?\b/i,
  /\bcredentials?\b/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)package\.json$/i,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock(b)?)$/i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)\.gitlab-ci\.ya?ml$/i,
  /(^|\/)dockerfile$/i,
  /(^|\/)railway\.json$/i,
  /(^|\/)vercel\.json$/i,
  /\bcors\b|\bheaders?\b.*security|csp|content-security-policy/i,
  /\bredirect/i,
  /(^|\/)mcp\.json$/i,
  /(^|\/)\.cursor\//i,
  /(^|\/)\.claude\//i,
  /stdio-bridge|install-manifest|local-verdict-bundle/i,
  /\bfetch\(|axios|http\.request/i,
];

/**
 * Paths that are treated as NOT security-relevant on their own -- pure
 * documentation, formatting/comment-only artifacts, and cosmetic styling.
 * A change is only skipped when EVERY changed path matches one of these AND
 * none matches HIGH_RELEVANCE_PATTERNS above.
 */
const LOW_RELEVANCE_PATTERNS: RegExp[] = [
  /\.(md|mdx|txt)$/i,
  /(^|\/)(readme|changelog|license|contributing)(\.[a-z]+)?$/i,
  /\.(css|scss|less)$/i,
  /(^|\/)\.prettierrc/i,
  /(^|\/)\.editorconfig$/i,
];

export type SecurityRelevanceResult = {
  relevant: boolean;
  matchedPaths: string[];
  reason: string;
};

function isHighRelevance(path: string): boolean {
  return HIGH_RELEVANCE_PATTERNS.some((pattern) => pattern.test(path));
}

function isLowRelevanceOnly(path: string): boolean {
  return LOW_RELEVANCE_PATTERNS.some((pattern) => pattern.test(path)) && !isHighRelevance(path);
}

/**
 * Classifies a batch of changed (relative) file paths. Empty input is never
 * relevant (nothing changed). A single high-relevance path makes the whole
 * batch relevant, regardless of how many low-relevance paths accompany it.
 */
export function classifySecurityRelevance(changedPaths: readonly string[]): SecurityRelevanceResult {
  if (changedPaths.length === 0) {
    return { relevant: false, matchedPaths: [], reason: "No changed files to evaluate." };
  }

  const highMatches = changedPaths.filter((path) => isHighRelevance(path));
  if (highMatches.length > 0) {
    return {
      relevant: true,
      matchedPaths: highMatches,
      reason: `${highMatches.length} changed file(s) match a security-relevant pattern.`,
    };
  }

  const allLowRelevance = changedPaths.every((path) => isLowRelevanceOnly(path));
  if (allLowRelevance) {
    return {
      relevant: false,
      matchedPaths: [],
      reason: "All changed files are documentation/formatting/styling only.",
    };
  }

  // Uncertain: not explicitly high-relevance, but not confidently
  // low-relevance either (e.g. a plain UI component or utility file). The
  // master prompt's own bias applies: trigger rather than silently skip.
  return {
    relevant: true,
    matchedPaths: [...changedPaths],
    reason: "Changed files are not recognized as documentation/formatting-only; reviewing conservatively.",
  };
}
