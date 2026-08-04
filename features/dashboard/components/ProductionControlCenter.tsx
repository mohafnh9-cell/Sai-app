import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <section
      className={`product-hero rounded-3xl border p-8 sm:p-10 surface-premium animate-in fade-in slide-in-from-bottom-2 duration-500 ${tone}`}
      aria-labelledby="mission-control-home-heading"
    >
      <div className="max-w-3xl space-y-8">
        <p className="text-sm text-muted-foreground font-medium">{greeting}</p>

        {showFirstVerdictWelcome && (
          <p className="text-sm text-muted-foreground">{labels.firstVerdictWelcome}</p>
        )}

        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.24em] text-muted-foreground">
            {labels.productionVerdict}
          </p>
          <p className="text-sm text-muted-foreground">{labels.readyToShipQuestion}</p>
          <p
            id="mission-control-home-heading"
            className={`text-4xl sm:text-5xl md:text-6xl font-semibold tracking-tighter leading-none break-words ${
              orgCanDeploy
                ? "text-brand-success"
                : isAlmostReady
                  ? "text-brand-warning"
                  : "text-foreground"
            }`}
          >
            {deployAnswer}
          </p>
        </div>

        {!orgCanDeploy && topPriority && (
          <div className="space-y-2 pt-2">
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
              {labels.fixThisFirst}
            </p>
            <p className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              {topPriority.title}
            </p>
          </div>
        )}

        <div className="pt-2">
          <Button size="lg" className="h-12 px-8 text-base rounded-xl shadow-premium" asChild>
            <Link href={projectHref}>
              {ctaLabel}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
