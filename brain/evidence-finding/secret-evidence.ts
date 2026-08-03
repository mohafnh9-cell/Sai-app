import type { EvidenceItem } from "./schema";

const PROVIDER_PATTERNS: Array<{ provider: string; pattern: RegExp; ruleId: string }> = [
  { provider: "OpenAI", pattern: /\bsk-[A-Za-z0-9]{10,}/, ruleId: "OPENAI_API_KEY" },
  { provider: "GitHub", pattern: /\bgh[oprsu]_[A-Za-z0-9_]{20,}/, ruleId: "GITHUB_TOKEN" },
  { provider: "AWS", pattern: /\bAKIA[A-Z0-9]{16}\b/, ruleId: "AWS_ACCESS_KEY_ID" },
  { provider: "Stripe", pattern: /\bsk_live_[A-Za-z0-9]{12,}/, ruleId: "STRIPE_SECRET_KEY" },
  { provider: "Supabase", pattern: /SUPABASE_SERVICE_ROLE_KEY|service[_-]?role/i, ruleId: "SUPABASE_SERVICE_ROLE_KEY" },
];

export function identifySecretProvider(input: {
  evidence?: string;
  ruleId?: string;
  fingerprintMaterial?: string;
}): { provider: string; ruleId: string; partialFingerprint: string } | null {
  const haystack = `${input.evidence ?? ""} ${input.fingerprintMaterial ?? ""} ${input.ruleId ?? ""}`;
  for (const row of PROVIDER_PATTERNS) {
    const match = haystack.match(row.pattern);
    if (match) {
      const token = match[0];
      return {
        provider: row.provider,
        ruleId: row.ruleId,
        partialFingerprint: token.length > 8 ? `${token.slice(0, 3)}...${token.slice(-4)}` : "[REDACTED]",
      };
    }
  }

  const envMatch = haystack.match(/([A-Z0-9_]{3,})=\[REDACTED\]/);
  if (envMatch) {
    return {
      provider: inferProviderFromEnvName(envMatch[1]),
      ruleId: envMatch[1],
      partialFingerprint: envMatch[1],
    };
  }

  if (input.fingerprintMaterial && /^[A-Z0-9_]+$/.test(input.fingerprintMaterial)) {
    return {
      provider: inferProviderFromEnvName(input.fingerprintMaterial),
      ruleId: input.fingerprintMaterial,
      partialFingerprint: input.fingerprintMaterial,
    };
  }

  return null;
}

function inferProviderFromEnvName(name: string): string {
  const upper = name.toUpperCase();
  if (upper.includes("OPENAI")) return "OpenAI";
  if (upper.includes("GITHUB")) return "GitHub";
  if (upper.includes("AWS") || upper.startsWith("AKIA")) return "AWS";
  if (upper.includes("STRIPE")) return "Stripe";
  if (upper.includes("SUPABASE")) return "Supabase";
  if (upper.includes("ANTHROPIC")) return "Anthropic";
  return "Unknown provider";
}

export function buildSecretEvidenceItems(input: {
  provider: string;
  ruleId: string;
  filePath: string;
  line: number;
  partialFingerprint: string;
  regexMatched: boolean;
}): EvidenceItem[] {
  return [
    {
      id: "regex-match",
      kind: "regex_match",
      label: "Pattern matched",
      detail: `Rule ${input.ruleId} matched at ${input.filePath}:${input.line}.`,
      confidence: 0.85,
    },
    {
      id: "provider",
      kind: "provider_identified",
      label: "Provider identified",
      detail: input.provider,
      confidence: 0.9,
    },
    {
      id: "fingerprint",
      kind: "partial_fingerprint",
      label: "Partial fingerprint",
      detail: input.partialFingerprint,
      confidence: 0.8,
    },
    {
      id: "location",
      kind: "file_location",
      label: "File location",
      detail: `${input.filePath}:${input.line}`,
      confidence: 1,
    },
  ];
}

export function secretRemediation(input: {
  provider: string;
  ruleId: string;
  filePath: string;
  line: number;
  partialFingerprint: string;
}): string {
  return [
    `Revoke the ${input.provider} credential identified by rule ${input.ruleId}.`,
    `Remove the value from ${input.filePath} (line ${input.line}).`,
    `Rotate the secret using your ${input.provider} dashboard.`,
    `Load the new value from a secret manager instead of source control.`,
    `Reference fingerprint: ${input.partialFingerprint}.`,
  ].join(" ");
}
