/**
 * Platform Convergence — certification environment guards (staging + main).
 * Pure functions testable from Vitest; no secrets logged.
 */

export const MAIN_CERTIFICATION_CONFIRMATION_VALUE =
  "I_UNDERSTAND_THIS_USES_THE_MAIN_ENVIRONMENT";

export const PRODUCTION_HOST_PATTERNS = [
  /^https:\/\/app\.sequrai\.com/i,
  /^https:\/\/www\.sequrai\.com/i,
  /^https:\/\/sequrai\.com/i,
];

export const DESTRUCTIVE_CERT_ENV_KEYS = ["CERTIFICATION_ALLOW_DESTRUCTIVE", "CERTIFICATION_ALLOW_CLEANUP"];

export const FORBIDDEN_LIVE_SCENARIOS = new Set(["B", "C", "D"]);

export const SECRET_LIKE_PATTERNS = [
  /sk_live_[a-zA-Z0-9]+/,
  /sk_test_[a-zA-Z0-9]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN (RSA |EC )?PRIVATE KEY-----/,
];

export function trimEnv(env, name) {
  return env[name]?.trim() ?? "";
}

export function parseCsv(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeOrigin(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return "";
  }
}

export function redactUrl(url) {
  return normalizeOrigin(url) || "(invalid url)";
}

export function isProductionHostUrl(url) {
  if (!url?.trim()) return false;
  return PRODUCTION_HOST_PATTERNS.some((re) => re.test(url.trim()));
}

/** Production URL guard — NODE_ENV alone must not grant or deny certification. */
export function isBlockedProductionExecution(env, mode) {
  const appUrl = trimEnv(env, "NEXT_PUBLIC_APP_URL");
  const stagingUrl = trimEnv(env, "STAGING_BASE_URL");
  const legacyBypass = trimEnv(env, "PLATFORM_CONVERGENCE_CERT_ALLOW_PRODUCTION") === "1";

  if (mode === "main") {
    return { blocked: false, reasons: [] };
  }

  if (legacyBypass) {
    return { blocked: false, reasons: [] };
  }

  const reasons = [];
  if (isProductionHostUrl(appUrl)) {
    reasons.push("NEXT_PUBLIC_APP_URL matches blocked production host pattern");
  }
  if (isProductionHostUrl(stagingUrl)) {
    reasons.push("STAGING_BASE_URL matches blocked production host pattern");
  }
  return { blocked: reasons.length > 0, reasons };
}

export function isFaultInjectionEnabled(env) {
  if (trimEnv(env, "ALLOW_PLATFORM_CONVERGENCE_FAULT_INJECTION") === "1") return true;
  if (trimEnv(env, "PLATFORM_CONVERGENCE_CERT_INJECT_FAULT")) return true;
  return false;
}

export function isDestructiveCertEnabled(env) {
  return DESTRUCTIVE_CERT_ENV_KEYS.some((key) => trimEnv(env, key) === "1");
}

export function containsSecretLikeMaterial(value) {
  if (!value) return false;
  return SECRET_LIKE_PATTERNS.some((re) => re.test(value));
}

export function evaluateMainCertificationGate(env) {
  const errors = [];

  if (trimEnv(env, "ALLOW_MAIN_CERTIFICATION") !== "1") {
    errors.push("ALLOW_MAIN_CERTIFICATION=1 is required for main certification");
  }
  if (trimEnv(env, "MAIN_CERTIFICATION_CONFIRMATION") !== MAIN_CERTIFICATION_CONFIRMATION_VALUE) {
    errors.push(
      `MAIN_CERTIFICATION_CONFIRMATION must be exactly ${MAIN_CERTIFICATION_CONFIRMATION_VALUE}`
    );
  }
  if (!trimEnv(env, "STAGING_CERT_ORG_ID")) {
    errors.push("STAGING_CERT_ORG_ID is required");
  }
  if (!trimEnv(env, "STAGING_CERT_PROJECT_ID")) {
    errors.push("STAGING_CERT_PROJECT_ID is required");
  }

  const certProjectIds = parseCsv(trimEnv(env, "CERTIFICATION_PROJECT_IDS"));
  const projectId = trimEnv(env, "STAGING_CERT_PROJECT_ID");
  if (certProjectIds.length === 0) {
    errors.push("CERTIFICATION_PROJECT_IDS must list allowed certification/test project ids");
  } else if (projectId && !certProjectIds.includes(projectId)) {
    errors.push("STAGING_CERT_PROJECT_ID is not listed in CERTIFICATION_PROJECT_IDS");
  }

  const mainUrl = trimEnv(env, "MAIN_CERTIFICATION_URL");
  const appUrl = trimEnv(env, "NEXT_PUBLIC_APP_URL");
  if (!mainUrl) {
    errors.push("MAIN_CERTIFICATION_URL is required");
  } else if (!appUrl) {
    errors.push("NEXT_PUBLIC_APP_URL is required");
  } else if (normalizeOrigin(mainUrl) !== normalizeOrigin(appUrl)) {
    errors.push("MAIN_CERTIFICATION_URL must match NEXT_PUBLIC_APP_URL origin");
  }

  const fixtureRepos = parseCsv(trimEnv(env, "CERTIFICATION_FIXTURE_REPOSITORIES"));
  if (fixtureRepos.length === 0) {
    errors.push("CERTIFICATION_FIXTURE_REPOSITORIES must list non-production fixture repos");
  }
  for (const repo of fixtureRepos) {
    if (containsSecretLikeMaterial(repo)) {
      errors.push("CERTIFICATION_FIXTURE_REPOSITORIES contains secret-like material");
      break;
    }
  }

  if (isFaultInjectionEnabled(env)) {
    errors.push("Fault injection env vars must be unset or disabled for main certification");
  }
  if (isDestructiveCertEnabled(env)) {
    errors.push("Destructive certification flags must be disabled");
  }

  const scenario = trimEnv(env, "STAGING_CERT_SCENARIO") || "A";
  if (scenario !== "A") {
    errors.push("Only Scenario A is permitted for live main certification");
  }
  if (FORBIDDEN_LIVE_SCENARIOS.has(scenario)) {
    errors.push(`Scenario ${scenario} is not permitted on main certification`);
  }

  return { ok: errors.length === 0, errors };
}

export function evaluateStagingCertificationGate(env, cliArgs = {}) {
  const missing = [];
  const supabaseUrl = trimEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = trimEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const stagingBase = trimEnv(env, "STAGING_BASE_URL");
  const orgId = trimEnv(env, "STAGING_CERT_ORG_ID");
  const projectId = trimEnv(env, "STAGING_CERT_PROJECT_ID");

  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!stagingBase) missing.push("STAGING_BASE_URL");
  if (!orgId) missing.push("STAGING_CERT_ORG_ID");
  if (!projectId) missing.push("STAGING_CERT_PROJECT_ID");

  const flagsOk =
    trimEnv(env, "FEATURE_RT9_BUSINESS_LOGIC") !== "" ||
    trimEnv(env, "FEATURE_LLM_RED_TEAM") !== "" ||
    cliArgs.skipFlagCheck === true;
  if (!flagsOk) {
    missing.push("FEATURE_RT9_BUSINESS_LOGIC or FEATURE_LLM_RED_TEAM (or pass --skip-flag-check)");
  }

  const productionBlock = isBlockedProductionExecution(env, "staging");
  if (productionBlock.blocked) {
    missing.push(...productionBlock.reasons.map((r) => `Refusing production target: ${r}`));
  }

  if (isFaultInjectionEnabled(env) && !cliArgs.allowFaultInjectionForStaging) {
    missing.push("Fault injection must be disabled for certification inspect/poll");
  }

  return {
    ok: missing.length === 0,
    missing,
    certificationEnvironment: "staging",
  };
}

export function evaluateMainCertificationPreflight(env, cliArgs = {}) {
  const base = evaluateMainCertificationGate(env);
  const missing = [...base.errors];

  if (!trimEnv(env, "NEXT_PUBLIC_SUPABASE_URL")) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!trimEnv(env, "SUPABASE_SERVICE_ROLE_KEY")) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  const flagsOk =
    trimEnv(env, "FEATURE_RT9_BUSINESS_LOGIC") !== "" ||
    trimEnv(env, "FEATURE_LLM_RED_TEAM") !== "" ||
    cliArgs.skipFlagCheck === true;
  if (!flagsOk) {
    missing.push("FEATURE_RT9_BUSINESS_LOGIC or FEATURE_LLM_RED_TEAM (or pass --skip-flag-check)");
  }

  return {
    ok: missing.length === 0,
    missing,
    certificationEnvironment: "main",
    mainCertificationOptIn: trimEnv(env, "ALLOW_MAIN_CERTIFICATION") === "1",
  };
}

export function normalizeRepoFullName(githubRepo) {
  if (!githubRepo?.trim()) return "";
  const raw = githubRepo.trim();
  try {
    if (raw.startsWith("http")) {
      const path = new URL(raw).pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
      return path.toLowerCase();
    }
  } catch {
    return raw.toLowerCase();
  }
  return raw.replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").toLowerCase();
}

export function isAllowedFixtureRepository(githubRepo, env) {
  const allowed = parseCsv(trimEnv(env, "CERTIFICATION_FIXTURE_REPOSITORIES")).map((r) =>
    normalizeRepoFullName(r)
  );
  const normalized = normalizeRepoFullName(githubRepo);
  return normalized.length > 0 && allowed.includes(normalized);
}

export function validateCertificationProjectRecord(project, env) {
  const errors = [];
  const orgId = trimEnv(env, "STAGING_CERT_ORG_ID");
  const projectId = trimEnv(env, "STAGING_CERT_PROJECT_ID");

  if (!project) {
    return { ok: false, errors: ["Certification project not found"] };
  }
  if (project.id !== projectId) {
    errors.push("Project id does not match STAGING_CERT_PROJECT_ID");
  }
  if (project.organization_id !== orgId) {
    errors.push("Project organization_id does not match STAGING_CERT_ORG_ID (cross-tenant blocked)");
  }

  const certIds = parseCsv(trimEnv(env, "CERTIFICATION_PROJECT_IDS"));
  if (!certIds.includes(project.id)) {
    errors.push("Project is not listed in CERTIFICATION_PROJECT_IDS (certification/test scope)");
  }

  const nameMarker = typeof project.name === "string" && project.name.startsWith("[CERT]");
  if (!nameMarker) {
    errors.push("Project must be marked for certification (name prefix [CERT])");
  }

  if (!isAllowedFixtureRepository(project.github_repo, env)) {
    errors.push("Project github_repo is not an allowed CERTIFICATION_FIXTURE_REPOSITORIES entry");
  }
  if (containsSecretLikeMaterial(project.github_repo ?? "")) {
    errors.push("Project repository reference contains secret-like material");
  }

  return { ok: errors.length === 0, errors };
}

export function validateSingleScanJobInspect(env) {
  const scanJobId = trimEnv(env, "STAGING_CERT_SCAN_JOB_ID");
  const errors = [];
  if (!scanJobId) {
    errors.push("STAGING_CERT_SCAN_JOB_ID is required for inspect/poll");
  }
  if (parseCsv(trimEnv(env, "STAGING_CERT_SCAN_JOB_IDS")).length > 1) {
    errors.push("Only one scan job may be inspected (multiple STAGING_CERT_SCAN_JOB_IDS not allowed)");
  }
  return { ok: errors.length === 0, errors, scanJobId: scanJobId || null };
}

export function validateLiveScenarioForMode(env, mode) {
  const scenario = trimEnv(env, "STAGING_CERT_SCENARIO") || "A";
  const errors = [];
  if (mode === "main") {
    if (scenario !== "A") errors.push("Main certification allows Scenario A only");
    if (isFaultInjectionEnabled(env)) errors.push("Fault injection blocked for main live certification");
    if (isDestructiveCertEnabled(env)) errors.push("Destructive tests blocked for main live certification");
  }
  return { ok: errors.length === 0, errors, scenario };
}
