import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IntelligenceSurface } from "@/components/sequrai";
import { verdictToneClass } from "@/brain/production-verdict/status-ui";
import type { DashboardFocus } from "@/lib/dashboard/pick-primary-project";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

type ProductionControlCenterProps = {
  greeting: string;
  focus: DashboardFocus;
  showFirstVerdictWelcome?: boolean;
  labels: {
    productionVerdict: string;
    readyToShipQuestion: string;
    deployYes: string;
    deployNo: string;
    almostReady: string;
    fixThisFirst: string;
    fixIssue: string;
    reviewProject: string;
    firstVerdictWelcome: string;
  };
};

export function ProductionControlCenter({
  greeting,
  focus,
  showFirstVerdictWelcome = false,
  labels,
}: ProductionControlCenterProps) {
  const { primary, orgCanDeploy, topPriority } = focus;
  const projectHref = projectVerdictHref(primary.projectId);
  const isAlmostReady = primary.status === "almost_ready";

  const deployAnswer = orgCanDeploy
    ? labels.deployYes
    : isAlmostReady
      ? labels.almostReady
      : labels.deployNo;

  const ctaLabel = orgCanDeploy ? labels.reviewProject : labels.fixIssue;
  const tone = orgCanDeploy ? verdictToneClass("ready_to_ship") : verdictToneClass(primary.status);

  return (
    <IntelligenceSurface
      toneClass={tone}
      className="product-hero max-w-3xl"
      aria-labelledby="mission-control-home-heading"
    >
      <div className="space-y-8">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">{greeting}</p>
          {showFirstVerdictWelcome ? (
            <p className="text-sm text-success">{labels.firstVerdictWelcome}</p>
          ) : null}
        </div>

        <div className="space-y-3">
          <p className="text-eyebrow">{labels.productionVerdict}</p>
          <p className="text-sm text-muted-foreground">{labels.readyToShipQuestion}</p>
          <p id="mission-control-home-heading" className="text-display-headline">
            {deployAnswer}
          </p>
        </div>

        {!orgCanDeploy && topPriority ? (
          <div className="space-y-2 pt-2 border-t border-border/40">
            <p className="text-label-caps">{labels.fixThisFirst}</p>
            <p className="text-lg font-semibold tracking-tight leading-snug">{topPriority.title}</p>
          </div>
        ) : null}

        <Button size="lg" className="h-11 px-6" asChild>
          <Link href={projectHref}>
            {ctaLabel}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </IntelligenceSurface>
  );
}
