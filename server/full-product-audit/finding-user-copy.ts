import {
  isNonBlockingSecretClassification,
  type SecretEvidenceClassification,
} from "@/features/security-scanner/rules/secret-classification";
import type {
  AuditFindingTechnicalEvidence,
  AuditFindingUserFacing,
  ConsolidatedAuditFinding,
  FindingVerificationStatus,
} from "./types";

import type { ConfidenceLevel } from "@/brain/confidence/types";
import { CONFIDENCE_LEVEL_LABELS } from "@/brain/confidence/derive";

function confidenceLabelFromLevel(level: ConfidenceLevel): string {
  switch (level) {
    case "VERIFIED":
      return "Verificado";
    case "PROBABLE":
      return "Probable";
    case "INFERRED":
      return "Inferido";
    case "SPECULATIVE":
      return "Especulativo";
    default:
      return CONFIDENCE_LEVEL_LABELS.PROBABLE;
  }
}

function confidenceLabelFromVerification(
  verificationStatus: FindingVerificationStatus,
  secretClassification?: SecretEvidenceClassification
): string {
  if (secretClassification === "TEST_FIXTURE") return "Valor de prueba — no confirmado como credencial real";
  if (secretClassification === "PLACEHOLDER") return "Marcador de posición — no confirmado como credencial real";
  if (secretClassification === "FALSE_POSITIVE") return "Probable falso positivo — no confirmado";
  switch (verificationStatus) {
    case "CONFIRMED":
      return "Confirmado";
    case "LIKELY":
      return "Probable";
    case "POTENTIAL":
      return "Potencial — no confirmado";
    case "NOT_REPRODUCED":
      return "No reproducido";
    case "FALSE_POSITIVE":
      return "Falso positivo";
    case "NOT_APPLICABLE":
      return "No aplicable";
    default:
      return "Sin confirmar";
  }
}

function dynamicVerificationCopy(finding: ConsolidatedAuditFinding): {
  status: string;
  reason: string;
} {
  if (finding.source === "both" && finding.verificationStatus === "CONFIRMED") {
    return {
      status: "Confirmado",
      reason: "SequrAI realizó una prueba controlada sobre la aplicación autorizada y pudo reproducir el riesgo.",
    };
  }
  if (finding.verificationStatus === "NOT_REPRODUCED") {
    return {
      status: "No confirmado",
      reason: "La prueba controlada no pudo verificar este hallazgo de forma segura.",
    };
  }
  if (finding.evidence.some((line) => line.toLowerCase().includes("blocked"))) {
    return {
      status: "Bloqueado",
      reason: "La prueba se detuvo porque la ruta solicitada quedó fuera del alcance de seguridad aprobado.",
    };
  }
  if (
    finding.ruleId === "secrets.exposed" ||
    isNonBlockingSecretClassification(finding.secretClassification)
  ) {
    return {
      status: "No probado",
      reason: "Este tipo de hallazgo no tiene una prueba dinámica segura disponible.",
    };
  }
  if (finding.source === "security_test") {
    return {
      status: finding.verificationStatus === "CONFIRMED" ? "Confirmado" : "No confirmado",
      reason:
        finding.verificationStatus === "CONFIRMED"
          ? "SequrAI completó una prueba controlada sobre la aplicación autorizada."
          : "La prueba controlada no produjo evidencia concluyente.",
    };
  }
  return {
    status: "No probado",
    reason: "Solo hay evidencia de revisión de código; no se ejecutó una prueba dinámica coincidente.",
  };
}

function whatToDoCopy(finding: ConsolidatedAuditFinding): string {
  if (finding.secretClassification === "TEST_FIXTURE") {
    return "No se requiere acción si este valor es solo un fixture de prueba. Confirma que no se usa en producción.";
  }
  if (finding.secretClassification === "PLACEHOLDER") {
    return "Confirma que este valor es solo un marcador de posición y no una credencial real.";
  }
  if (finding.secretClassification === "FALSE_POSITIVE") {
    return "Puedes ignorar este aviso si el valor no es una credencial real.";
  }
  if (finding.verificationStatus === "CONFIRMED") {
    return "Corrige este riesgo y vuelve a ejecutar la auditoría para verificar el arreglo.";
  }
  if (finding.ruleId === "secrets.exposed") {
    return "Comprueba si este valor es una credencial real. Si lo es, elimínalo del código y rótalo.";
  }
  return finding.recommendation ?? "Revisa el hallazgo y corrige la causa raíz antes de desplegar.";
}

export function buildAuditFindingUserFacing(
  finding: ConsolidatedAuditFinding
): AuditFindingUserFacing {
  const dynamic = dynamicVerificationCopy(finding);
  const safeToIgnore = isNonBlockingSecretClassification(finding.secretClassification);

  return {
    simpleExplanation: safeToIgnore
      ? "Este valor parece un fixture de prueba o marcador de posición, no una credencial de producción."
      : finding.verificationStatus === "CONFIRMED"
        ? "SequrAI encontró un riesgo de seguridad con evidencia estática y dinámica."
        : "SequrAI encontró un valor en tu código que parece una credencial o riesgo de seguridad.",
    whyItMatters: safeToIgnore
      ? "Los fixtures de prueba no deberían bloquear el despliegue, pero conviene confirmar que no se usan en producción."
      : finding.verificationStatus === "CONFIRMED"
        ? "Este problema puede explotarse en la aplicación autorizada."
        : "Si fuera una credencial real y alguien accediera al código, podría usarla para acceder a un servicio externo.",
    confidenceLabel: finding.confidenceLevel
      ? confidenceLabelFromLevel(finding.confidenceLevel)
      : confidenceLabelFromVerification(finding.verificationStatus, finding.secretClassification),
    dynamicVerificationStatus: dynamic.status,
    dynamicVerificationReason: dynamic.reason,
    whatToDo: whatToDoCopy(finding),
    safeToIgnore,
  };
}

export function buildAuditFindingTechnicalEvidence(
  finding: ConsolidatedAuditFinding
): AuditFindingTechnicalEvidence {
  const items = finding.evidence.filter(
    (line) =>
      !line.startsWith("Static rule") &&
      !line.startsWith("Dynamic test available") &&
      !line.startsWith("Static analysis only")
  );
  if (finding.staticFindingId) items.push(`staticFindingId=${finding.staticFindingId}`);
  if (finding.attackFindingId) items.push(`attackFindingId=${finding.attackFindingId}`);
  if (finding.adapterId) items.push(`adapter=${finding.adapterId}`);
  if (finding.ruleId) items.push(`rule=${finding.ruleId}`);
  return { collapsedByDefault: true, items };
}

export function enrichAuditFindingUserFacing(
  findings: ConsolidatedAuditFinding[]
): ConsolidatedAuditFinding[] {
  return findings.map((finding) => ({
    ...finding,
    userFacing: buildAuditFindingUserFacing(finding),
    technicalEvidence: buildAuditFindingTechnicalEvidence(finding),
  }));
}

export function rankAuditFindingsForAction(findings: ConsolidatedAuditFinding[]): ConsolidatedAuditFinding[] {
  return [...findings].sort((a, b) => {
    const aBlocker = isProductionBlocking(a) ? 1 : 0;
    const bBlocker = isProductionBlocking(b) ? 1 : 0;
    if (aBlocker !== bBlocker) return bBlocker - aBlocker;
    const confirmedDiff =
      (a.verificationStatus === "CONFIRMED" ? 1 : 0) - (b.verificationStatus === "CONFIRMED" ? 1 : 0);
    if (confirmedDiff !== 0) return confirmedDiff;
    return severityRank(b.severity) - severityRank(a.severity);
  });
}

function isProductionBlocking(finding: ConsolidatedAuditFinding): boolean {
  if (isNonBlockingSecretClassification(finding.secretClassification)) return false;
  return finding.severity.toLowerCase() === "critical" || finding.severity.toLowerCase() === "high";
}

function severityRank(severity: string): number {
  switch (severity.toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "medium":
      return 3;
    case "low":
      return 2;
    default:
      return 1;
  }
}

export function buildWhatToFixFirstEntries(findings: ConsolidatedAuditFinding[]): string[] {
  const ranked = rankAuditFindingsForAction(findings).slice(0, 4);
  return ranked.map((finding, index) => {
    const prefix =
      finding.verificationStatus === "CONFIRMED"
        ? "Confirmado: "
        : finding.userFacing?.confidenceLabel?.startsWith("Potencial")
          ? "Potencial: "
          : finding.userFacing?.safeToIgnore
            ? "Informativo: "
            : "";
    const priority =
      isProductionBlocking(finding) && !finding.userFacing?.safeToIgnore
        ? " — prioridad alta, revisión requerida"
        : finding.userFacing?.safeToIgnore
          ? " — no requiere acción"
          : " — revisar antes de desplegar";
    return `${index + 1}. ${prefix}${finding.title}${priority}`;
  });
}

export function buildExecutiveSummaryLine(result: {
  verdictStatus: string | null;
  counts: { critical: number; high: number };
  topRisks: ConsolidatedAuditFinding[];
}): string {
  const blockers = result.counts.critical + result.counts.high;
  if (blockers === 0) {
    return "SequrAI no encontró bloqueadores de producción basados en la evidencia actual.";
  }
  const top = result.topRisks.find((risk) => !risk.userFacing?.safeToIgnore) ?? result.topRisks[0];
  if (!top) {
    return `Tu aplicación tiene ${blockers} problema(s) de alto riesgo que conviene revisar antes de producción.`;
  }
  if (top.verificationStatus === "CONFIRMED") {
    return "SequrAI confirmó al menos un riesgo de seguridad que debe revisarse antes de desplegar.";
  }
  return "SequrAI encontró un posible riesgo en tu código. Aún no está confirmado como explotable.";
}
