import type {
  DiscoverySignals,
  OrchestratorTeamId,
  TeamSelection,
} from "../aso.types";
import type { AttackDomain } from "../../types";

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

export function selectTeams(input: {
  signals: DiscoverySignals;
  adaptive: boolean;
}): TeamSelection[] {
  const { signals, adaptive } = input;

  const rules: Array<{
    teamId: OrchestratorTeamId;
    when: boolean;
    skipReason: string;
    complexity: TeamSelection["estimatedComplexity"];
  }> = [
    {
      teamId: "browser",
      when: signals.hasBrowserSurface,
      skipReason: "No browser attack surface detected",
      complexity: "medium",
    },
    {
      teamId: "authentication",
      when: !adaptive || (signals.hasAuthentication && !signals.isStaticSite),
      skipReason: signals.isStaticSite ? "Static site — authentication not applicable" : "No authentication stack detected",
      complexity: "medium",
    },
    {
      teamId: "api",
      when: !adaptive || signals.hasApiSurface,
      skipReason: "No API surface detected",
      complexity: "medium",
    },
    {
      teamId: "authorization",
      when: !adaptive || signals.hasAuthorizationModel,
      skipReason: "No authorization model detected",
      complexity: "high",
    },
    {
      teamId: "business_logic",
      when: !adaptive || signals.hasBusinessWorkflows,
      skipReason: signals.isStaticSite ? "Static site — business logic not applicable" : "No business workflow signals",
      complexity: "high",
    },
    {
      teamId: "llm",
      when: !adaptive || signals.hasLlm,
      skipReason: "No LLM or AI provider detected",
      complexity: "medium",
    },
    {
      teamId: "adversarial",
      when: !adaptive || signals.hasLlm || signals.hasMcp,
      skipReason: "Adversarial team requires LLM or MCP usage",
      complexity: "high",
    },
    {
      teamId: "intelligence",
      when: true,
      skipReason: "",
      complexity: "low",
    },
    {
      teamId: "decision",
      when: true,
      skipReason: "",
      complexity: "low",
    },
    {
      teamId: "engineering",
      when: true,
      skipReason: "",
      complexity: "medium",
    },
    {
      teamId: "replay",
      when: true,
      skipReason: "",
      complexity: "medium",
    },
    {
      teamId: "verdict",
      when: true,
      skipReason: "",
      complexity: "low",
    },
  ];

  if (signals.isStaticSite) {
    return rules.map((rule) => {
      const post = ["intelligence", "decision", "engineering", "replay", "verdict"].includes(rule.teamId);
      if (post) {
        return {
          teamId: rule.teamId,
          selected: true,
          skipReason: null,
          attackDomain: TEAM_DOMAIN[rule.teamId] ?? null,
          estimatedRuntimeMs: RUNTIME_EST[rule.teamId],
          estimatedComplexity: rule.complexity,
        };
      }
      const onlyBrowser = rule.teamId === "browser";
      return {
        teamId: rule.teamId,
        selected: onlyBrowser,
        skipReason: onlyBrowser ? null : "Static site — team not required",
        attackDomain: TEAM_DOMAIN[rule.teamId] ?? null,
        estimatedRuntimeMs: RUNTIME_EST[rule.teamId],
        estimatedComplexity: rule.complexity,
      };
    });
  }

  return rules.map((rule) => ({
    teamId: rule.teamId,
    selected: rule.when,
    skipReason: rule.when ? null : rule.skipReason,
    attackDomain: TEAM_DOMAIN[rule.teamId] ?? null,
    estimatedRuntimeMs: RUNTIME_EST[rule.teamId],
    estimatedComplexity: rule.complexity,
  }));
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
  const attackTeams = selections.filter((s) =>
    ["browser", "authentication", "api", "authorization", "business_logic", "llm", "adversarial"].includes(
      s.teamId
    )
  );
  const selected = attackTeams.filter((t) => t.selected);
  return selected.length === 1 && selected[0]?.teamId === "browser";
}
