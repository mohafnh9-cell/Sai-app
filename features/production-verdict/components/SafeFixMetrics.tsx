"use client";

import { assessSafeFix, riskColor, type ProductionFixPromptInput } from "@/brain/fix-prompt";
import { useI18n } from "@/lib/i18n/client";

export function SafeFixMetrics({ input }: { input: ProductionFixPromptInput }) {
  const { t } = useI18n("verdict");
  const assessment = assessSafeFix(input);
  const { estimatedScope } = assessment;

  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      <div>
        <p className="text-xs text-muted-foreground">{t("safeFixConfidence")}</p>
        <p className="font-medium">{assessment.safeFixConfidence}%</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t("implementationRisk")}</p>
        <p className={`font-medium ${riskColor(assessment.implementationRisk)}`}>
          {t(`implementationRiskLevel.${assessment.implementationRisk}` as "implementationRiskLevel.low")}
        </p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t("estimatedScope")}</p>
        <p className="font-medium text-xs leading-relaxed">
          {t("scopeFiles", { count: estimatedScope.filesExpected })} ·{" "}
          {t("scopeLoc", {
            min: estimatedScope.estimatedLocMin,
            max: estimatedScope.estimatedLocMax,
          })}
        </p>
      </div>
    </div>
  );
}
