import { randomUUID } from "node:crypto";
import type { GroupedFix, RegressionTestSpec } from "../fix-strategy.types";
import type { AttackFinding } from "../../types";

const DOMAIN_TESTS: Record<string, Omit<RegressionTestSpec, "id">[]> = {
  authentication: [
    {
      domain: "authentication",
      level: "integration",
      title: "Session invalidation after logout",
      description: "Ensure tokens/sessions cannot be reused after logout or rotation.",
    },
  ],
  authorization: [
    {
      domain: "authorization",
      level: "security",
      title: "Cross-tenant access denied",
      description: "Synthetic tenant A cannot read tenant B resources.",
    },
    {
      domain: "authorization",
      level: "security",
      title: "Object ownership enforced",
      description: "User cannot mutate another user's owned resource.",
    },
  ],
  api: [
    {
      domain: "api",
      level: "integration",
      title: "Admin routes require elevated role",
      description: "Non-admin receives 403 on admin endpoints.",
    },
  ],
  browser: [
    {
      domain: "browser",
      level: "security",
      title: "Sensitive tokens not in localStorage",
      description: "Browser storage scan finds no long-lived secrets.",
    },
  ],
  llm: [
    {
      domain: "llm",
      level: "security",
      title: "Prompt injection blocked",
      description: "Malicious system override strings do not change tool execution.",
    },
  ],
  payments: [
    {
      domain: "payments",
      level: "integration",
      title: "Webhook signature required",
      description: "Unsigned webhook payloads are rejected.",
    },
  ],
};

export function generateRegressionTests(input: {
  groupedFixes: GroupedFix[];
  findings: AttackFinding[];
}): RegressionTestSpec[] {
  const domains = new Set<string>();
  for (const fix of input.groupedFixes) {
    for (const id of fix.findingIds) {
      const f = input.findings.find((x) => x.id === id);
      if (f?.domain) domains.add(f.domain);
    }
  }
  if (input.groupedFixes.some((f) => f.rootCauseId === "rc.authorization_boundary")) {
    domains.add("authorization");
  }

  const specs: RegressionTestSpec[] = [];
  for (const domain of domains) {
    const templates = DOMAIN_TESTS[domain] ?? [
      {
        domain,
        level: "unit" as const,
        title: `${domain} security regression`,
        description: `Cover ${domain} findings from the attack campaign.`,
      },
    ];
    for (const t of templates) {
      specs.push({ id: randomUUID(), ...t });
    }
  }

  specs.push({
    id: randomUUID(),
    domain: "replay",
    level: "security",
    title: "Authorized replay confirmation",
    description: "Re-run SequrAI replay plans; exploited paths must fail.",
  });

  return specs;
}
