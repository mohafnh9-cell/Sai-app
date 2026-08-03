import type { DetectionMethod, EvidenceItem } from "./schema";
import type { ProjectType } from "./project-context";

export function computeFalsePositiveProbability(input: {
  detectionMethod: DetectionMethod;
  evidenceItems: EvidenceItem[];
  counterEvidenceItems: EvidenceItem[];
  projectType?: ProjectType;
  ruleId?: string;
  isSecretFinding?: boolean;
  hasProviderMatch?: boolean;
  hasEntropySignal?: boolean;
  hasRuntimeUsage?: boolean;
}): { probability: number; explanation: string } {
  let probability = 0.35;
  const reasons: string[] = [];

  const methodBase: Record<DetectionMethod, number> = {
    STATIC_ANALYSIS: 0.28,
    DYNAMIC_ANALYSIS: 0.18,
    REPLAY: 0.08,
    MOCK_SIMULATION: 0.32,
    AUTHORIZED_STAGING: 0.12,
    LIVE_VERIFICATION: 0.06,
    HYBRID: 0.15,
  };
  probability = methodBase[input.detectionMethod];
  reasons.push(`${input.detectionMethod.replaceAll("_", " ").toLowerCase()} detections start with ${Math.round(probability * 100)}% false-positive prior.`);

  if (input.isSecretFinding) {
    if (input.hasProviderMatch) {
      probability -= 0.12;
      reasons.push("Provider pattern matched a known credential format.");
    }
    if (input.hasEntropySignal) {
      probability -= 0.08;
      reasons.push("High-entropy value pattern detected.");
    }
    if (!input.hasRuntimeUsage) {
      probability += 0.1;
      reasons.push("No runtime usage was observed for the credential.");
    }
  }

  if (input.projectType === "marketing_website" || input.projectType === "landing_page") {
    if (input.ruleId?.includes("auth") || input.ruleId?.includes("unauthenticated")) {
      probability += 0.25;
      reasons.push("Project classified as a public marketing site where public pages may be intentional.");
    }
  }

  probability -= Math.min(0.15, input.evidenceItems.length * 0.03);
  probability += Math.min(0.2, input.counterEvidenceItems.length * 0.05);

  if (input.hasRuntimeUsage) {
    probability -= 0.1;
    reasons.push("Runtime usage confirmed.");
  }

  probability = Math.min(0.95, Math.max(0.02, Number(probability.toFixed(3))));
  return {
    probability,
    explanation: reasons.join(" "),
  };
}

export function falsePositivePercent(probability: number): number {
  return Math.round(probability * 100);
}

export function falsePositiveLabel(probability: number): string {
  if (probability <= 0.1) return "Very Low";
  if (probability <= 0.25) return "Low";
  if (probability <= 0.45) return "Moderate";
  if (probability <= 0.65) return "Elevated";
  return "High";
}
