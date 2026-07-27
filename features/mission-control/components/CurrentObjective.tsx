"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CopySafeFixPromptButton } from "@/features/production-verdict/components/CopySafeFixPromptButton";
import { fixPromptInputFromPriority } from "@/brain/fix-prompt";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { MissionObjectiveState } from "../types";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";

export function CurrentObjective({
  objective,
  projectId,
  verdict,
  fixPromptContext,
}: {
  objective: MissionObjectiveState;
  projectId: string;
  verdict: ProductionVerdictV1 | null;
  fixPromptContext?: FixPromptContext;
}) {
  const top = verdict?.topPriorities[0];
  const fixInput =
    top && fixPromptContext
      ? fixPromptInputFromPriority(top, {
          projectName: fixPromptContext.projectName,
          stack: fixPromptContext.stack,
          currentVerdictStatus: fixPromptContext.currentVerdictStatus,
          currentScore: fixPromptContext.currentScore,
        })
      : null;

  return (
    <section
      className="rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 space-y-6"
      aria-labelledby="current-objective-heading"
    >
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-primary mb-2">Current Objective</p>
        <h2 id="current-objective-heading" className="text-xl font-semibold tracking-tight">
          {objective.title}
        </h2>
      </div>
      <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
        <span>Estimated effort {objective.estimatedEffortLabel}</span>
        <span>Engineering Plan {objective.engineeringPlanStatus === "ready" ? "Ready" : "Pending"}</span>
        <span>Replay {objective.replayStatus === "passed" ? "Passed" : "Pending"}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {fixInput && objective.primaryAction === "generate_fix" ? (
          <CopySafeFixPromptButton
            input={fixInput}
            source="priority"
            priorityId={top?.id}
            label="Generate Fix"
          />
        ) : (
          <Button asChild>
            <Link href={`/projects/${projectId}`}>
              {objective.primaryAction === "analyze" ? "Start Analysis" : "Generate Fix"}
            </Link>
          </Button>
        )}
        <Button variant="outline" asChild>
          <Link href={`/projects/${projectId}`}>View Details</Link>
        </Button>
      </div>
    </section>
  );
}
