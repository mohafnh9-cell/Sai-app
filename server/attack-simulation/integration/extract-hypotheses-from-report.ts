import type { AttackFinding as RedTeamAttackFinding } from "@/server/ai-red-team/types";
import type { RedTeamReport } from "@/server/ai-red-team/types";
import type { AttackHypothesis } from "../contracts/attack-hypothesis";
import { attackHypothesisFromRedTeamFinding } from "../contracts/attack-hypothesis";

const MAX_HYPOTHESES = 20;

function categoryFromDomain(domain: string): string {
  switch (domain) {
    case "authorization":
      return "authorization";
    case "authentication":
      return "authentication";
    case "business_logic":
      return "business_logic";
    case "llm":
      return "llm";
    case "api":
      return "web";
    case "browser":
      return "web";
    default:
      return domain.replaceAll(".", "_") || "general";
  }
}

function sourceFromDomain(domain: string): string {
  if (domain === "business_logic") return "logic.business";
  if (domain === "llm") return "ai.llm";
  if (domain === "authorization") return "auth.authorization";
  if (domain === "authentication") return "auth.authentication";
  if (domain === "api") return "surface.api";
  if (domain === "browser") return "surface.browser";
  return `red_team.${domain}`;
}

function mapFindingToHypothesis(finding: RedTeamAttackFinding): AttackHypothesis {
  return attackHypothesisFromRedTeamFinding({
    id: finding.id,
    title: finding.title,
    description: finding.description,
    category: categoryFromDomain(finding.domain),
    severity: finding.severity,
    confidence: finding.confidence,
    source: sourceFromDomain(finding.domain),
    metadata: finding.metadata ?? {},
  });
}

export function extractAttackHypothesesFromRedTeamReport(
  report: RedTeamReport | null | undefined
): AttackHypothesis[] {
  if (!report) return [];

  const deduped = report.intelligence?.deduplicatedFindings ?? [];
  const flattened = report.results.flatMap((result) => result.findings);
  const candidates = deduped.length > 0 ? deduped : flattened;

  const seen = new Set<string>();
  const hypotheses: AttackHypothesis[] = [];

  for (const finding of candidates) {
    const key = `${finding.title}`.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    hypotheses.push(mapFindingToHypothesis(finding));
    if (hypotheses.length >= MAX_HYPOTHESES) break;
  }

  return hypotheses;
}
