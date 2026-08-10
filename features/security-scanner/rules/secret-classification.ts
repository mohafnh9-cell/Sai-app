import { SECRET_NAME_PATTERN } from "../constants";

export const SECRET_EVIDENCE_CLASSIFICATIONS = [
  "REAL_SECRET",
  "PROBABLE_SECRET",
  "POTENTIAL_SECRET",
  "TEST_FIXTURE",
  "PLACEHOLDER",
  "FALSE_POSITIVE",
] as const;

export type SecretEvidenceClassification = (typeof SECRET_EVIDENCE_CLASSIFICATIONS)[number];

export const SECRET_CLASSIFICATION_METADATA_KEY = "secretClassification";

const TEST_OR_EXAMPLE =
  /(?:^|\/)(?:test|tests|__tests__|fixtures?|examples?)(?:\/|$)|\.(?:test|spec)\./i;

export const REAL_CREDENTIAL_PATTERNS = [
  /\bsk_live_[A-Za-z0-9]{12,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/,
] as const;

const PLACEHOLDER_VALUE =
  /(?:example|sample|placeholder|your[_-]|change[_-]?me|xxx|test[_-]?key|process\.env|\$\{|generate-a|long-random|seq_live_\.\.\.|\.\.\.|not-a-real|replace-me|insert[-_]|fake[-_]|dummy)/i;

const TEST_FIXTURE_VALUE =
  /(?:^|[_./-])(?:mock|fake|dummy|sample|placeholder|test)(?:[_./-]|$)|(?:[_./-](?:test|mock|fake|dummy|sample|placeholder)(?:[_./-]|$))|(?:^test[_./-])|(?:oauth[_./-].*[_./-]test[_./-])|(?:[_./-]test[_./-](?:token|key|secret|credential|password|refresh))/i;

const MOCK_CONTEXT =
  /\b(?:vi\.mock|vi\.fn|jest\.mock|mockResolvedValue|mockImplementation|mockReturnValue|test fixture|fake provider|test provider|fixture|stub|test environment|beforeEach|describe\(|it\()\b/i;

const REAL_SECRET_CONTEXT =
  /\b(?:Authorization:\s*Bearer|Bearer\s+[A-Za-z0-9._-]+|createClient\s*\(|new\s+[A-Z][A-Za-z0-9]*Client|process\.env\.[A-Z0-9_]+|DATABASE_URL|apiKey|secretKey|credentials|authenticate|signIn|getAuth|serviceRole|connectionString)\b/i;

export type SecretClassificationInput = {
  path: string;
  value: string;
  variableName?: string;
  line: string;
  lineIndex: number;
  fileLines: readonly string[];
};

export type SecretClassificationResult = {
  classification: SecretEvidenceClassification;
  signals: string[];
  confidence: "high" | "medium" | "low";
};

export function isTestOrExampleFile(path: string): boolean {
  return TEST_OR_EXAMPLE.test(path);
}

export function matchesRealCredentialFormat(value: string): boolean {
  return REAL_CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

export function isNonBlockingSecretClassification(
  classification: SecretEvidenceClassification | undefined
): boolean {
  return (
    classification === "TEST_FIXTURE" ||
    classification === "PLACEHOLDER" ||
    classification === "FALSE_POSITIVE"
  );
}

function contextWindow(lines: readonly string[], lineIndex: number, radius = 4): string {
  const start = Math.max(0, lineIndex - radius);
  const end = Math.min(lines.length, lineIndex + radius + 1);
  return lines.slice(start, end).join("\n");
}

function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  const maxEntropy = Math.log2(Math.min(value.length, 256));
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

function looksLikeTestFixtureSecretValue(value: string): boolean {
  if (!value || matchesRealCredentialFormat(value)) return false;
  if (PLACEHOLDER_VALUE.test(value)) return true;
  if (TEST_FIXTURE_VALUE.test(value)) return true;
  if (/^lab[_./-]/i.test(value)) return true;
  return false;
}

export function classifySecretDetection(input: SecretClassificationInput): SecretClassificationResult {
  const { path, value, variableName, line, lineIndex, fileLines } = input;
  const signals: string[] = [];

  if (!value) {
    return { classification: "FALSE_POSITIVE", signals: ["empty_value"], confidence: "high" };
  }

  if (matchesRealCredentialFormat(value)) {
    return {
      classification: "REAL_SECRET",
      signals: ["known_credential_format"],
      confidence: "high",
    };
  }

  if (
    /^[a-zA-Z_$][\w$]*\(\)$/.test(value) ||
    (/^[a-z][a-zA-Z0-9_$]*$/.test(value) && value.length < 32 && shannonEntropy(value) < 0.5)
  ) {
    return {
      classification: "FALSE_POSITIVE",
      signals: ["identifier_not_literal"],
      confidence: "high",
    };
  }

  if (isTestOrExampleFile(path) && looksLikeTestFixtureSecretValue(value)) {
    return {
      classification: "TEST_FIXTURE",
      signals: ["test_file_path", "test_fixture_value_pattern"],
      confidence: "high",
    };
  }

  if (PLACEHOLDER_VALUE.test(value)) {
    return {
      classification: "PLACEHOLDER",
      signals: ["placeholder_semantics"],
      confidence: "high",
    };
  }

  let fixtureScore = 0;
  let realScore = 0;

  if (isTestOrExampleFile(path)) {
    fixtureScore += 1;
    signals.push("test_file_path");
  }

  if (looksLikeTestFixtureSecretValue(value)) {
    fixtureScore += 2;
    signals.push("test_fixture_value_pattern");
  }

  const nearby = `${contextWindow(fileLines, lineIndex)}\n${line}`;
  if (MOCK_CONTEXT.test(nearby)) {
    fixtureScore += 2;
    signals.push("mock_test_context");
  }
  if (REAL_SECRET_CONTEXT.test(nearby)) {
    realScore += 2;
    signals.push("production_auth_context");
  }

  const entropy = shannonEntropy(value);
  if (entropy >= 0.62 && value.length >= 16) {
    realScore += 1;
    signals.push("high_entropy");
  } else if (entropy <= 0.45 && value.length <= 32) {
    fixtureScore += 1;
    signals.push("low_entropy_readable");
  }

  if (variableName && SECRET_NAME_PATTERN.test(variableName)) {
    realScore += 0.5;
    signals.push("secret_variable_name");
  }

  if (fixtureScore >= 3 && realScore < 2) {
    return { classification: "TEST_FIXTURE", signals, confidence: "high" };
  }

  if (fixtureScore >= 2 && realScore === 0) {
    return { classification: "TEST_FIXTURE", signals, confidence: "high" };
  }

  if (realScore >= 2) {
    return {
      classification: realScore >= 2.5 ? "PROBABLE_SECRET" : "POTENTIAL_SECRET",
      signals,
      confidence: "medium",
    };
  }

  if (realScore >= 1 || entropy >= 0.55) {
    return { classification: "POTENTIAL_SECRET", signals, confidence: "medium" };
  }

  if (fixtureScore >= 1) {
    return { classification: "TEST_FIXTURE", signals, confidence: "medium" };
  }

  return { classification: "POTENTIAL_SECRET", signals, confidence: "low" };
}

export function severityForSecretClassification(
  classification: SecretEvidenceClassification
): "critical" | "high" | "medium" | "info" {
  switch (classification) {
    case "REAL_SECRET":
      return "high";
    case "PROBABLE_SECRET":
      return "high";
    case "POTENTIAL_SECRET":
      return "high";
    case "TEST_FIXTURE":
    case "PLACEHOLDER":
    case "FALSE_POSITIVE":
      return "info";
  }
}

export function confidenceForSecretClassification(
  classification: SecretEvidenceClassification,
  modelConfidence: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  if (isNonBlockingSecretClassification(classification)) return "low";
  return modelConfidence;
}

export function resolveSecretClassification(input: {
  ruleId?: string | null;
  filePath?: string | null;
  evidence?: string | null;
  metadata?: Record<string, unknown> | null;
}): SecretEvidenceClassification | undefined {
  const fromMetadata = input.metadata?.[SECRET_CLASSIFICATION_METADATA_KEY];
  if (typeof fromMetadata === "string") {
    return fromMetadata as SecretEvidenceClassification;
  }
  return inferSecretClassificationFromPersistedFinding(input);
}

/** Backfill classification for scan rows persisted before secretClassification metadata existed. */
export function inferSecretClassificationFromPersistedFinding(input: {
  ruleId?: string | null;
  filePath?: string | null;
  evidence?: string | null;
}): SecretEvidenceClassification | undefined {
  if ((input.ruleId ?? "").toLowerCase() !== "secrets.exposed") return undefined;
  const path = input.filePath ?? "";
  if (!path || !isTestOrExampleFile(path)) return undefined;

  const evidence = (input.evidence ?? "").trim();
  if (/^credential=\[REDACTED\]$/i.test(evidence)) {
    return undefined;
  }
  if (/^[A-Za-z0-9_]+=\[REDACTED\]$/.test(evidence)) {
    return "TEST_FIXTURE";
  }
  return "TEST_FIXTURE";
}
