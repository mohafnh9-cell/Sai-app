import type { BusinessImpactAssessment, NormalizedObservation } from "./models";

function levelFromSeverity(severity: NormalizedObservation["severity"]): "none" | "low" | "medium" | "high" {
  if (severity === "critical" || severity === "high") return "high";
  if (severity === "medium") return "medium";
  if (severity === "low") return "low";
  return "none";
}

export function assessBusinessImpact(observations: NormalizedObservation[]): BusinessImpactAssessment[] {
  return observations.map((obs) => {
    const text = `${obs.title} ${obs.description}`.toLowerCase();
    const session = /session|cookie|hijack|token|localstorage/.test(text);
    const payment = /payment|stripe|billing|subscription|financial/.test(text);
    const data = /database|pii|customer|account/.test(text);
    const availability = /error|outage|availability|crash/.test(text);

    let headline = "This issue could affect production reliability or user trust.";
    let narrative = obs.description;

    if (session) {
      headline = "An attacker could hijack authenticated sessions and gain access to customer accounts.";
      narrative =
        "Browser-visible session material increases the risk of account takeover if an attacker can run script in the application context.";
    } else if (payment) {
      headline = "Payment or subscription flows could be manipulated, affecting revenue and customer billing.";
      narrative = "Issues near billing surfaces can translate into financial loss or unauthorized subscription changes.";
    } else if (data) {
      headline = "Sensitive customer or business data could be exposed or modified.";
    } else if (availability) {
      headline = "Users may hit broken flows, eroding trust during launch.";
    }

    const sevLevel = levelFromSeverity(obs.severity);
    return {
      findingId: obs.id,
      headline,
      narrative,
      dimensions: {
        confidentiality: session || data ? sevLevel : "low",
        integrity: payment || data ? sevLevel : "low",
        availability: availability ? sevLevel : "none",
      },
      financialImpact: payment ? sevLevel : session ? "medium" : "none",
      trustImpact: sevLevel === "none" ? "low" : sevLevel,
      deploymentImpact: obs.severity === "critical" || obs.severity === "high" ? "high" : sevLevel,
    };
  });
}

export function aggregateRiskScore(impacts: BusinessImpactAssessment[]): number {
  const weights = { none: 0, low: 1, medium: 2, high: 3 };
  return impacts.reduce((sum, impact) => {
    return (
      sum +
      weights[impact.deploymentImpact] * 2 +
      weights[impact.trustImpact] +
      weights[impact.financialImpact] * 1.5
    );
  }, 0);
}
