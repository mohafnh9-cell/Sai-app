import type { SafeFixAssessment } from "@/brain/fix-prompt/assessment";
import type { SafeFixDocumentV2, SafeFixPrDraft } from "./types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function preparePullRequestDraft(input: {
  projectName: string;
  blockerTitle: string;
  severity: string;
  document: SafeFixDocumentV2;
  assessment: SafeFixAssessment;
}): SafeFixPrDraft {
  const slug = slugify(input.blockerTitle) || "production-blocker";
  const branchName = `sequrai/safe-fix/${slug}`;

  const commitMessage = `fix(production): ${input.blockerTitle}\n\nSequrAI Safe Fix — ${input.severity} blocker.\n${input.document.executiveSummary}`;

  const prTitle = `[SequrAI Safe Fix] ${input.blockerTitle}`;

  const prDescription = [
    "## Summary",
    input.document.executiveSummary,
    "",
    "## Why this matters",
    input.document.whyThisMatters,
    "",
    "## Risk if ignored",
    input.document.riskIfIgnored,
    "",
    "## Files to change",
    ...input.document.filesToChange.map((f) => `- ${f}`),
    "",
    "## Testing checklist",
    ...input.document.verificationChecklist.map((c) => `- [ ] ${c}`),
    "",
    "_Prepared by SequrAI — founder approval required before merge._",
  ].join("\n");

  return {
    branchName,
    commitMessage,
    prTitle,
    prDescription,
    riskSummary: `${input.assessment.implementationRisk} — ${input.assessment.riskReason}`,
    testingChecklist: input.document.verificationChecklist,
    rollbackChecklist: input.document.rollbackConsiderations,
  };
}
