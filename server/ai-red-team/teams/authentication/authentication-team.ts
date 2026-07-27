import { randomUUID } from "node:crypto";
import type { DiscoveryReport } from "../../discovery/types";
import type { AttackPlan } from "../../types";
import type { AttackSeverity } from "../../types";

export type AuthenticationTeamFinding = {
  findingId: string;
  category: string;
  title: string;
  founderSummary: string;
  technicalExplanation: string;
  severity: AttackSeverity;
  confidence: number;
  correlationKeys: string[];
  safeFixEligible: boolean;
  remediationDirection: string;
};

export type AuthenticationTeamResult = {
  runId: string;
  findings: AuthenticationTeamFinding[];
  signalsChecked: string[];
};

export type AuthenticationTeamInput = {
  runId: string;
  discovery: DiscoveryReport;
  plan: AttackPlan;
};

export class AuthenticationTeam {
  async run(input: AuthenticationTeamInput): Promise<AuthenticationTeamResult> {
    const findings: AuthenticationTeamFinding[] = [];
    const signalsChecked: string[] = ["discovery_auth_providers", "discovery_attack_surface"];

    const providers = input.discovery.authenticationProviders;
    if (providers.length === 0 && input.discovery.potentialAttackSurface.some((s) => s.area === "authentication")) {
      findings.push(this.finding({
        category: "auth_surface",
        title: "Authentication surface detected without declared providers",
        founderSummary:
          "The application appears to expose login or session flows, but Discovery did not identify a clear authentication provider.",
        technicalExplanation:
          "Attack surface includes authentication while authenticationProviders is empty in the Discovery Report.",
        severity: "medium",
        confidence: 0.72,
        correlationKeys: ["auth-provider-gap"],
        remediationDirection: "Document and verify the authentication stack (OAuth, session, or IdP) in configuration.",
      }));
    }

    const weakSignals = providers.filter((p) => p.confidence < 0.5);
    if (weakSignals.length > 0) {
      findings.push(this.finding({
        category: "auth_confidence",
        title: "Low-confidence authentication configuration signals",
        founderSummary:
          "Discovery is uncertain about how users sign in, which makes production auth testing harder.",
        technicalExplanation: `Providers with low confidence: ${weakSignals.map((p) => p.name).join(", ")}`,
        severity: "low",
        confidence: 0.65,
        correlationKeys: ["auth-discovery-weak"],
        remediationDirection: "Ensure auth libraries and environment configuration are detectable in the repository.",
      }));
    }

    if (input.discovery.potentialAttackSurface.some((s) => s.area === "authentication" && s.confidence >= 0.7)) {
      signalsChecked.push("high_confidence_auth_surface");
    }

    return {
      runId: input.runId,
      findings,
      signalsChecked,
    };
  }

  private finding(input: Omit<AuthenticationTeamFinding, "findingId">): AuthenticationTeamFinding {
    return {
      findingId: randomUUID(),
      safeFixEligible: true,
      ...input,
    };
  }
}

export function createAuthenticationTeam(): AuthenticationTeam {
  return new AuthenticationTeam();
}
