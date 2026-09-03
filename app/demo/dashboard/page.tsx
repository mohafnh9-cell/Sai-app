import Link from "next/link";
import { FolderGit2, Plus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ProductionControlCenter } from "@/features/dashboard/components/ProductionControlCenter";
import { PortfolioVerdictCard } from "@/features/production-verdict/components/PortfolioVerdictCard";
import { buildDemoDataset } from "@/features/demo/fixtures/build-demo-dataset";
import { demoHref } from "@/features/demo/paths";
import { parseDemoScenario } from "@/features/demo/scenarios";
import { pickPrimaryDashboardFocus } from "@/lib/dashboard/pick-primary-project";
import { partitionPortfolioProjects } from "@/lib/dashboard/filter-portfolio-projects";
import { getTranslator } from "@/lib/i18n/server";

export default async function DemoDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string; firstVerdict?: string }>;
}) {
  const params = await searchParams;
  const scenario = parseDemoScenario(params.scenario);
  const dataset = buildDemoDataset(scenario);
  const { t } = await getTranslator("dashboard");
  const { t: tv } = await getTranslator("verdict");
  const { t: tc } = await getTranslator("common");

  const projectReadiness = new Map(
    dataset.orgBrain.projects.map((item) => [item.projectId, item])
  );
  const verdictsByProject = new Map(
    Object.values(dataset.projectBrains)
      .filter((brain) => brain.currentVerdict)
      .map((brain) => [brain.projectId, brain.currentVerdict!])
  );
  const focus = pickPrimaryDashboardFocus(dataset.orgBrain.projects, verdictsByProject);
  const projects = dataset.projects;
  const showPortfolio = projects.length > 1;
  const { needsAttention } = partitionPortfolioProjects(projects, projectReadiness);
  const showNeedsAttention = showPortfolio && needsAttention.length > 0;

  return (
    <div className="app-shell-bg min-h-full">
      <div className="mx-auto max-w-5xl px-4 sm:p-6 sm:px-8 py-10 sm:py-14 pb-20 space-y-10">
        {projects.length === 0 ? (
          <EmptyState
            icon={FolderGit2}
            title={t("noProjectsTitle")}
            description={t("noProjectsBody")}
            action={{ label: t("connectRepository"), href: demoHref("/integrations", scenario) }}
          />
        ) : (
          <>
            {focus && (
              <ProductionControlCenter
                greeting={t("greetingAfternoon", { name: "Demo" })}
                focus={focus}
                showFirstVerdictWelcome={
                  params.firstVerdict === "1" || dataset.showFirstVerdictModal
                }
                labels={{
                  productionVerdict: tv("productionVerdict"),
                  readyToShipQuestion: t("readyToShipQuestion"),
                  deployYes: t("deployYes"),
                  deployNo: t("deployNo"),
                  almostReady: t("almostReady"),
                  fixThisFirst: t("fixThisFirst"),
                  fixIssue: t("fixIssue"),
                  reviewProject: t("reviewProject"),
                  firstVerdictWelcome: t("firstVerdictWelcome"),
                }}
              />
            )}

            {showPortfolio && (
              <>
                {showNeedsAttention && (
                  <section className="space-y-4">
                    <div>
                      <h2 className="text-lg font-medium tracking-tight">{t("needsAttentionTitle")}</h2>
                      <p className="text-sm text-muted-foreground mt-1">{t("needsAttentionSubtitle")}</p>
                    </div>
                    <div className="space-y-2">
                      {needsAttention.map((project) => (
                        <PortfolioVerdictCard
                          key={project.id}
                          projectId={project.id}
                          projectName={project.name}
                          summary={projectReadiness.get(project.id)}
                        />
                      ))}
                    </div>
                  </section>
                )}

                <section className="space-y-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-medium tracking-tight">{t("yourAppsTitle")}</h2>
                      <p className="text-sm text-muted-foreground mt-1">{t("yourAppsSubtitle")}</p>
                    </div>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={demoHref("/projects", scenario)} className="gap-1.5 text-muted-foreground">
                        {tc("viewAll")} <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {projects.map((project) => (
                      <PortfolioVerdictCard
                        key={project.id}
                        projectId={project.id}
                        projectName={project.name}
                        summary={projectReadiness.get(project.id)}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}

            <div className="flex justify-center pt-2">
              <Button size="sm" variant="outline" disabled className="shrink-0" aria-disabled>
                <Plus className="mr-2 h-4 w-4" />
                {t("connectRepository")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
