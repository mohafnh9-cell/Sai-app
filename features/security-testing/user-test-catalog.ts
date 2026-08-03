import type { Translator } from "@/lib/i18n/types";
import type { SecurityTestOption } from "./types";

export const DEFAULT_SECURITY_TEST_IDS = [
  "idor-cross-tenant",
  "unauthenticated-endpoint",
  "workflow-bypass",
  "webhook-signature-bypass",
  "double-credit-consumption",
  "idempotency-replay",
] as const;

function testCopy(adapterId: string, t: Translator) {
  const titleKey = `tests.${adapterId}.title`;
  const descriptionKey = `tests.${adapterId}.description`;
  const categoryKey = `tests.${adapterId}.categoryLabel`;
  return {
    title: t(titleKey),
    description: t(descriptionKey),
    categoryLabel: t(categoryKey),
  };
}

export function buildFallbackSecurityTestOptions(t: Translator): SecurityTestOption[] {
  return DEFAULT_SECURITY_TEST_IDS.map((id, index) => {
    const friendly = testCopy(id, t);
    return {
      id,
      title: friendly.title,
      description: friendly.description,
      severity: index < 2 ? "high" : "medium",
      categoryLabel: friendly.categoryLabel,
      recommended: index < 4,
    };
  });
}

export function friendlyTestCopy(adapterId: string, t: Translator) {
  return testCopy(adapterId, t);
}
