"use client";

import { useCallback, useState } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildSafeFixPrompt, type ProductionFixPromptInput } from "@/brain/fix-prompt";
import { trackEvent } from "@/lib/analytics/track";
import { useI18n } from "@/lib/i18n/client";

export function CopySafeFixPromptButton({
  input,
  source,
  priorityId,
  findingId,
  size = "sm",
  variant = "outline",
  className,
  label,
  copiedLabel,
}: {
  input: ProductionFixPromptInput;
  source: "priority" | "finding" | "intelligence";
  priorityId?: string;
  findingId?: string;
  size?: "sm" | "default";
  variant?: "outline" | "secondary" | "default";
  className?: string;
  label?: string;
  copiedLabel?: string;
}) {
  const { t } = useI18n("verdict");
  const [copied, setCopied] = useState(false);

  const copyPrompt = useCallback(async () => {
    const { prompt, assessment } = buildSafeFixPrompt(input);
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/demo")) {
      trackEvent("safe_fix_prompt_copied", {
        source,
        priorityId,
        findingId,
        category: input.category,
        severity: input.severity,
        confidence: assessment.safeFixConfidence,
        risk: assessment.implementationRisk,
      });
    }
    window.setTimeout(() => setCopied(false), 2000);
  }, [findingId, input, priorityId, source]);

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      aria-pressed={copied}
      onClick={() => void copyPrompt()}
    >
      {copied ? (
        <>
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {copiedLabel ?? t("copiedSafeFixPrompt")}
        </>
      ) : (
        <>
          <ClipboardCopy className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {label ?? t("copySafeFixPrompt")}
        </>
      )}
    </Button>
  );
}

/** @deprecated Use CopySafeFixPromptButton */
export const CopyProductionFixPromptButton = CopySafeFixPromptButton;
