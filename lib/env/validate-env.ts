export type EnvValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

type EnvRule = {
  key: string;
  required: boolean;
  productionRequired?: boolean;
  secret?: boolean;
  validate?: (value: string) => string | null;
};

const PLACEHOLDER_PATTERNS = [
  /your[_-]?supabase/i,
  /tu-proyecto/i,
  /tu_service_role/i,
  /placeholder/i,
  /changeme/i,
];

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const RULES: EnvRule[] = [
  { key: "NEXT_PUBLIC_APP_URL", required: false, productionRequired: true },
  { key: "NEXT_PUBLIC_SUPABASE_URL", required: true, productionRequired: true },
  { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", required: true, productionRequired: true },
  { key: "SUPABASE_SERVICE_ROLE_KEY", required: false, productionRequired: true, secret: true },
  { key: "GITHUB_WEBHOOK_SECRET", required: false, productionRequired: true, secret: true },
  { key: "ANTHROPIC_API_KEY", required: false, productionRequired: false, secret: true },
  { key: "GITHUB_TOKEN_ENCRYPTION_KEY", required: false, productionRequired: false, secret: true },
  { key: "SCAN_SCHEDULER", required: false },
  { key: "INNGEST_EVENT_KEY", required: false, secret: true },
  { key: "INNGEST_SIGNING_KEY", required: false, secret: true },
  { key: "SEQURAI_BYPASS_AUTH", required: false },
];

export function validateEnvironment(options?: {
  production?: boolean;
}): EnvValidationResult {
  const production = options?.production ?? process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rule of RULES) {
    const value = process.env[rule.key]?.trim();
    const mustExist = rule.required || (production && rule.productionRequired);

    if (mustExist && !value) {
      errors.push(`Missing required environment variable: ${rule.key}`);
      continue;
    }

    if (!value) continue;

    if (isPlaceholder(value)) {
      errors.push(`${rule.key} appears to be a placeholder value`);
    }

    if (rule.validate) {
      const validationError = rule.validate(value);
      if (validationError) errors.push(validationError);
    }
  }

  const bypass = process.env.SEQURAI_BYPASS_AUTH?.trim().toLowerCase();
  if (production && bypass && ["true", "1", "yes"].includes(bypass)) {
    errors.push("SEQURAI_BYPASS_AUTH must not be enabled in production");
  }

  if (production && !process.env.GITHUB_WEBHOOK_SECRET) {
    errors.push("GITHUB_WEBHOOK_SECRET is required in production for Continuous Reviews");
  }

  if (production && !process.env.GITHUB_TOKEN_ENCRYPTION_KEY) {
    warnings.push(
      "GITHUB_TOKEN_ENCRYPTION_KEY is not set — GitHub tokens are stored encrypted-at-rest only when this key is configured"
    );
  }

  if (production && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    errors.push("SUPABASE_SERVICE_ROLE_KEY is required in production for webhooks and scans");
  }

  const scheduler = process.env.SCAN_SCHEDULER?.trim().toLowerCase();
  if (scheduler === "inngest") {
    if (!process.env.INNGEST_EVENT_KEY?.trim()) {
      errors.push("INNGEST_EVENT_KEY is required when SCAN_SCHEDULER=inngest");
    }
    if (production && !process.env.INNGEST_SIGNING_KEY?.trim()) {
      errors.push("INNGEST_SIGNING_KEY is required in production when SCAN_SCHEDULER=inngest");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
