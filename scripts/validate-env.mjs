#!/usr/bin/env node
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), ".env.local"), override: true });
config({ path: resolve(process.cwd(), ".env"), override: true });

const production = process.argv.includes("--production");
const staging = process.argv.includes("--staging");

function validate() {
  const errors = [];
  const warnings = [];

  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ];

  const productionRequired = [
    "NEXT_PUBLIC_APP_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "GITHUB_WEBHOOK_SECRET",
  ];

  const stagingRequired = [
    "STAGING_BASE_URL",
    "INTERNAL_OPS_TOKEN",
    "GITHUB_WEBHOOK_SECRET",
  ];

  for (const key of required) {
    if (!process.env[key]?.trim()) errors.push(`Missing ${key}`);
  }

  if (production) {
    for (const key of productionRequired) {
      if (!process.env[key]?.trim()) errors.push(`Missing ${key} (required in production)`);
    }
    if (!process.env.INTERNAL_OPS_TOKEN?.trim()) {
      warnings.push("INTERNAL_OPS_TOKEN not set — ops health endpoint will reject all requests");
    }
    if (process.env.SCAN_SCHEDULER?.trim().toLowerCase() === "inngest") {
      if (!process.env.INNGEST_EVENT_KEY?.trim()) {
        errors.push("Missing INNGEST_EVENT_KEY (required when SCAN_SCHEDULER=inngest)");
      }
      if (!process.env.INNGEST_SIGNING_KEY?.trim()) {
        errors.push("Missing INNGEST_SIGNING_KEY (required when SCAN_SCHEDULER=inngest in production)");
      }
    }
  }

  if (staging) {
    for (const key of stagingRequired) {
      if (!process.env[key]?.trim()) errors.push(`Missing ${key} (required for staging validation)`);
    }
    if (process.env.SCAN_SCHEDULER?.trim().toLowerCase() === "inngest") {
      if (!process.env.INNGEST_EVENT_KEY?.trim()) {
        errors.push("Missing INNGEST_EVENT_KEY (required when SCAN_SCHEDULER=inngest)");
      }
      if (!process.env.INNGEST_SIGNING_KEY?.trim()) {
        errors.push("Missing INNGEST_SIGNING_KEY (required when SCAN_SCHEDULER=inngest on staging)");
      }
    }
    const host = process.env.STAGING_BASE_URL ? new URL(process.env.STAGING_BASE_URL).hostname : "";
    if (host && !host.includes("staging") && process.env.LOAD_TEST_ALLOW_LOCALHOST !== "true") {
      warnings.push("STAGING_BASE_URL hostname does not contain 'staging' — confirm this is not production");
    }
  }

  const bypass = process.env.SEQURAI_BYPASS_AUTH?.trim().toLowerCase();
  if ((production || process.env.NODE_ENV === "production") && ["true", "1", "yes"].includes(bypass ?? "")) {
    errors.push("SEQURAI_BYPASS_AUTH must not be enabled in production");
  }

  if (production && !process.env.GITHUB_TOKEN_ENCRYPTION_KEY) {
    warnings.push("GITHUB_TOKEN_ENCRYPTION_KEY not set — GitHub tokens stored without encryption at rest");
  }

  // Never print secret values — only report presence
  const secretKeys = [
    "INNGEST_EVENT_KEY",
    "INNGEST_SIGNING_KEY",
    "INTERNAL_OPS_TOKEN",
    "GITHUB_WEBHOOK_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  for (const key of secretKeys) {
    const value = process.env[key]?.trim();
    if (value) console.log(`${key}: [set, length=${value.length}]`);
    else if (staging || production) console.log(`${key}: [not set]`);
  }

  return { errors, warnings };
}

const { errors, warnings } = validate();

for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (errors.length > 0) {
  console.error("Environment validation failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const mode = production ? "production" : staging ? "staging" : "development";
console.log(`Environment validation passed (${mode} mode).`);
