"use client";

import type { MissionControlView } from "../types";
import type { ProductionVerdictV1 } from "@/brain/production-verdict/schema";
import type { FixPromptContext } from "@/features/production-verdict/fix-prompt-context";
import { MissionHeader } from "./MissionHeader";
import { ActiveTeams } from "./ActiveTeams";
import { WhyTheseTeams } from "./WhyTheseTeams";
import { MissionFeed } from "./MissionFeed";
import { CurrentObjective } from "./CurrentObjective";
import { ProductionVerdictCardSection } from "./ProductionVerdictCard";

export function MissionControlExperience({
  view,
  verdict,
  fixPromptContext,
}: {
  view: MissionControlView;
  verdict: ProductionVerdictV1 | null;
  fixPromptContext?: FixPromptContext;
}) {
  return (
    <div className="space-y-12 sm:space-y-16 max-w-3xl mx-auto">
      <MissionHeader header={view.header} />
      <ActiveTeams teams={view.teams} />
      <WhyTheseTeams reasons={view.teamReasons} />
      <MissionFeed items={view.feed} />
      <CurrentObjective
        objective={view.objective}
        projectId={view.projectId}
        verdict={verdict}
        fixPromptContext={fixPromptContext}
      />
      <ProductionVerdictCardSection verdict={view.verdict} />
    </div>
  );
}
