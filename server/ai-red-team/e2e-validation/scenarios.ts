import type { DiscoveryRepositoryInput } from "../discovery/types";
import type { DiscoveryReport } from "../discovery/types";

export type PlatformE2eScenarioId =
  | "simple_saas"
  | "multi_tenant_saas"
  | "ai_saas"
  | "rag_application"
  | "mcp_application"
  | "agentic_system"
  | "hybrid_ai_saas";

export type PlatformE2eScenario = {
  id: PlatformE2eScenarioId;
  label: string;
  organizationId: string;
  projectId: string;
  commitSha: string;
  discoveryRepository: DiscoveryRepositoryInput;
  /** Fixed correlation / execution anchor for validation runs. */
  requestId: string;
};

const INTERNAL_ORG = "org-e2e-platform-validation";

function baseRepo(input: {
  projectId: string;
  commitSha: string;
  files: DiscoveryRepositoryInput["files"];
}): DiscoveryRepositoryInput {
  return {
    projectId: input.projectId,
    organizationId: INTERNAL_ORG,
    commitSha: input.commitSha,
    files: input.files,
  };
}

function npmPackage(extra: Record<string, string>): string {
  return JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0", ...extra } });
}

export const PLATFORM_E2E_SCENARIOS: PlatformE2eScenario[] = [
  {
    id: "simple_saas",
    label: "Simple SaaS (checkout + auth)",
    organizationId: INTERNAL_ORG,
    projectId: "proj-simple-saas",
    commitSha: "e2e00000000000000000000000000000000000001",
    requestId: "e2e-req-simple-saas",
    discoveryRepository: baseRepo({
      projectId: "proj-simple-saas",
      commitSha: "e2e00000000000000000000000000000000000001",
      files: [
        { path: "package.json", content: npmPackage({ stripe: "14.0.0", "@clerk/nextjs": "6.0.0" }) },
        { path: "app/api/checkout/route.ts", content: "export async function POST() { return stripe.checkout(); }" },
      ],
    }),
  },
  {
    id: "multi_tenant_saas",
    label: "Multi-tenant SaaS (billing + webhooks + admin)",
    organizationId: INTERNAL_ORG,
    projectId: "proj-multi-tenant",
    commitSha: "e2e00000000000000000000000000000000000002",
    requestId: "e2e-req-multi-tenant",
    discoveryRepository: baseRepo({
      projectId: "proj-multi-tenant",
      commitSha: "e2e00000000000000000000000000000000000002",
      files: [
        {
          path: "package.json",
          content: npmPackage({ stripe: "14.0.0", "@supabase/supabase-js": "2.0.0" }),
        },
        { path: "app/admin/page.tsx", content: "export default function Admin() { return null; }" },
        { path: "app/api/webhooks/stripe/route.ts", content: "export async function POST() {}" },
        { path: "prisma/schema.prisma", content: 'model Org { id String @id organizationId String }' },
      ],
    }),
  },
  {
    id: "ai_saas",
    label: "AI SaaS (LLM API)",
    organizationId: INTERNAL_ORG,
    projectId: "proj-ai-saas",
    commitSha: "e2e00000000000000000000000000000000000003",
    requestId: "e2e-req-ai-saas",
    discoveryRepository: baseRepo({
      projectId: "proj-ai-saas",
      commitSha: "e2e00000000000000000000000000000000000003",
      files: [
        { path: "package.json", content: npmPackage({ openai: "4.0.0", ai: "4.0.0" }) },
        { path: "app/api/chat/route.ts", content: "import { streamText } from 'ai'; export async function POST() {}" },
      ],
    }),
  },
  {
    id: "rag_application",
    label: "RAG Application",
    organizationId: INTERNAL_ORG,
    projectId: "proj-rag",
    commitSha: "e2e00000000000000000000000000000000000004",
    requestId: "e2e-req-rag",
    discoveryRepository: baseRepo({
      projectId: "proj-rag",
      commitSha: "e2e00000000000000000000000000000000000004",
      files: [
        {
          path: "package.json",
          content: npmPackage({ "@langchain/core": "0.3.0", openai: "4.0.0", ai: "4.0.0" }),
        },
        { path: "lib/rag/retriever.ts", content: "export function retrieve() { return vectorStore.similaritySearch(); }" },
      ],
    }),
  },
  {
    id: "mcp_application",
    label: "MCP Application",
    organizationId: INTERNAL_ORG,
    projectId: "proj-mcp",
    commitSha: "e2e00000000000000000000000000000000000005",
    requestId: "e2e-req-mcp",
    discoveryRepository: baseRepo({
      projectId: "proj-mcp",
      commitSha: "e2e00000000000000000000000000000000000005",
      files: [
        { path: "package.json", content: npmPackage({ "@modelcontextprotocol/sdk": "1.0.0", openai: "4.0.0" }) },
        { path: "mcp/server.ts", content: "import { Server } from '@modelcontextprotocol/sdk/server';" },
      ],
    }),
  },
  {
    id: "agentic_system",
    label: "Agentic System",
    organizationId: INTERNAL_ORG,
    projectId: "proj-agentic",
    commitSha: "e2e00000000000000000000000000000000000006",
    requestId: "e2e-req-agentic",
    discoveryRepository: baseRepo({
      projectId: "proj-agentic",
      commitSha: "e2e00000000000000000000000000000000000006",
      files: [
        { path: "package.json", content: npmPackage({ langchain: "0.3.0", "@langchain/langgraph": "0.2.0" }) },
        { path: "agents/planner.ts", content: "export const agent = { tools: [], delegate: true };" },
      ],
    }),
  },
  {
    id: "hybrid_ai_saas",
    label: "Hybrid AI SaaS (payments + LLM + MCP)",
    organizationId: INTERNAL_ORG,
    projectId: "proj-hybrid",
    commitSha: "e2e00000000000000000000000000000000000007",
    requestId: "e2e-req-hybrid",
    discoveryRepository: baseRepo({
      projectId: "proj-hybrid",
      commitSha: "e2e00000000000000000000000000000000000007",
      files: [
        {
          path: "package.json",
          content: npmPackage({
            stripe: "14.0.0",
            openai: "4.0.0",
            ai: "4.0.0",
            "@modelcontextprotocol/sdk": "1.0.0",
          }),
        },
        { path: "app/api/chat/route.ts", content: "export async function POST() {}" },
        { path: "mcp/tools/billing.ts", content: "export const tool = { name: 'billing' };" },
      ],
    }),
  },
];

export function getPlatformE2eScenario(id: PlatformE2eScenarioId): PlatformE2eScenario {
  const scenario = PLATFORM_E2E_SCENARIOS.find((s) => s.id === id);
  if (!scenario) throw new Error(`Unknown E2E scenario ${id}`);
  return scenario;
}

/** Deterministic fingerprint of verdict-driving fields (excludes random decisionId). */
export function productionVerdictFingerprint(report: {
  productionVerdict?: { status: string; summary: string; confidence: string; primaryRecommendation: string };
  intelligence?: { correlations: unknown[]; attackChains: unknown[] };
  discovery: { commitSha: string; reportId: string };
}): string {
  const pv = report.productionVerdict;
  return JSON.stringify({
    commitSha: report.discovery.commitSha,
    discoveryReportId: report.discovery.reportId,
    status: pv?.status ?? null,
    summary: pv?.summary ?? null,
    confidence: pv?.confidence ?? null,
    primaryRecommendation: pv?.primaryRecommendation ?? null,
    correlationCount: report.intelligence?.correlations.length ?? 0,
    chainCount: report.intelligence?.attackChains.length ?? 0,
  });
}

export function scenarioExpectsRt10(discovery: DiscoveryReport): boolean {
  const caps = discovery.potentialAttackSurface.map((s) => s.area);
  return caps.includes("llm") || caps.includes("mcp_servers") || discovery.aiProviders.length > 0;
}

export function scenarioExpectsRt9(discovery: DiscoveryReport): boolean {
  return (
    discovery.potentialAttackSurface.some((s) => s.area === "payments") || discovery.payments.length > 0
  );
}

export const PLATFORM_E2E_INTERNAL_ORG = INTERNAL_ORG;
