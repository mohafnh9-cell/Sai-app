import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getTranslator } from "@/lib/i18n/server";
import { ProjectWorkflowNav } from "@/features/mission-control/components/ProjectWorkflowNav";
import { ProductionJourneyView } from "@/features/production-journey/components/ProductionJourneyView";
import {
  buildDemoDataset,
  getDemoProject,
} from "@/features/demo/fixtures/build-demo-dataset";
import { demoHref } from "@/features/demo/paths";
import { parseDemoScenario } from "@/features/demo/scenarios";

export default async function DemoProjectJourneyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scenario?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const scenario = parseDemoScenario(query.scenario);
  const dataset = buildDemoDataset(scenario);
  const project = getDemoProject(dataset, id);
  if (!project) notFound();

  const { t: tp } = await getTranslator("projects");
  const { t } = await getTranslator("productionJourney");
  const journey = dataset.journeys[id] ?? null;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-1">
        <Link href={demoHref(`/projects/${id}`, scenario)}>
          <ArrowLeft className="h-4 w-4" />
          {tp("backToProjects")}
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <ProjectWorkflowNav projectId={id} showSecurityTest={false} />

      {journey ? (
        <ProductionJourneyView journey={journey} projectId={id} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("emptyTimeline")}</p>
      )}
    </div>
  );
}
