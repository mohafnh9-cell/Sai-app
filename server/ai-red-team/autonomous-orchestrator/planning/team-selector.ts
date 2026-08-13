import type {
  DiscoverySignals,
  OrchestratorTeamId,
  TeamSelection,
} from "../aso.types";
import type { AttackDomain } from "../../types";

const ATTACK_TEAMS: OrchestratorTeamId[] = [
  "browser",
  "authentication",
  "api",
  "authorization",
  "business_logic",
  "llm",
  "adversarial",
];

const TEAM_DOMAIN: Partial<Record<OrchestratorTeamId, AttackDomain>> = {
  browser: "browser",
  authentication: "authentication",
  api: "api",
  authorization: "authorization",
  business_logic: "payments",
  llm: "llm",
};

const RUNTIME_EST: Record<OrchestratorTeamId, number> = {
  browser: 45_000,
  authentication: 15_000,
  api: 30_000,
  authorization: 25_000,
  business_logic: 20_000,
  llm: 25_000,
  adversarial: 35_000,
  intelligence: 5_000,
  decision: 2_000,
  engineering: 8_000,
  replay: 20_000,
  verdict: 1_000,
};

const COMPLEXITY: Record<OrchestratorTeamId, TeamSelection["estimatedComplexity"]> = {
  browser: "medium",
  authentication: "medium",
  api: "medium",
  authorization: "high",
  business_logic: "high",
  llm: "medium",
  adversarial: "high",
  intelligence: "low",
  decision: "low",
  engineering: "medium",
  replay: "medium",
  verdict: "low",
};

const ADAPTIVE_SKIP: Partial<Record<OrchestratorTeamId, (signals: DiscoverySignals) => string | null>> = {
  browser: (signals) => (signals.hasBrowserSurface ? null : "No browser attack surface detected"),
  authentication: (signals) =>
    signals.isStaticSite
      ? "Static site — authentication not applicable"
      : signals.hasAuthentication
        ? null
        : "No authentication stack detected",
  api: (signals) => (signals.hasApiSurface ? null : "No API surface detected"),
  authorization: (signals) => (signals.hasAuthorizationModel ? null : "No authorization model detected"),
  business_logic: (signals) =>
    signals.isStaticSite
      ? "Static site — business logic not applicable"
      : signals.hasBusinessWorkflows
        ? null
        : "No business workflow signals",
  llm: (signals) => (signals.hasLlm ? null : "No LLM or AI provider detected"),
  adversarial: (signals) =>
    signals.hasLlm || signals.hasMcp ? null : "Adversarial team requires LLM or MCP usage",
};

function buildSelection(
  teamId: OrchestratorTeamId,
  selected: boolean,
  skipReason: string | null
): TeamSelection {
  return {
    teamId,
    selected,
    skipReason,
    attackDomain: TEAM_DOMAIN[teamId] ?? null,
    estimatedRuntimeMs: RUNTIME_EST[teamId],
    estimatedComplexity: COMPLEXITY[teamId],
  };
}

export function selectTeams(input: {
  signals: DiscoverySignals;
  adaptive: boolean;
}): TeamSelection[] {
  const { signals, adaptive } = input;

  const attackSelections = ATTACK_TEAMS.map((teamId) => {
    if (!adaptive) {
      return buildSelection(teamId, true, null);
    }
    const skipReason = ADAPTIVE_SKIP[teamId]?.(signals) ?? null;
    return buildSelection(teamId, skipReason === null, skipReason);
  });

  const postPipeline: OrchestratorTeamId[] = [
    "intelligence",
    "decision",
    "engineering",
    "replay",
    "verdict",
  ];

  return [
    ...attackSelections,
    ...postPipeline.map((teamId) => buildSelection(teamId, true, null)),
  ];
}

export function selectedAttackDomains(selections: TeamSelection[]): AttackDomain[] {
  const order: AttackDomain[] = [
    "browser",
    "authentication",
    "api",
    "authorization",
    "payments",
    "llm",
  ];
  const selected = new Set(
    selections.filter((s) => s.selected && s.attackDomain).map((s) => s.attackDomain!)
  );
  return order.filter((d) => selected.has(d));
}

export function staticSiteBrowserOnly(selections: TeamSelection[]): boolean {
  const attackTeams = selections.filter((s) => ATTACK_TEAMS.includes(s.teamId));
  const selected = attackTeams.filter((t) => t.selected);
  return selected.length === 1 && selected[0]?.teamId === "browser";
}
