import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProjectCard } from "@/features/projects/components/ProjectCard";
import { buildDemoDataset } from "@/features/demo/fixtures/build-demo-dataset";
import { demoHref, demoProjectPath } from "@/features/demo/paths";
import { parseDemoScenario } from "@/features/demo/scenarios";
import { getTranslator } from "@/lib/i18n/server";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import { FolderGit2 } from "lucide-react";

export default async function DemoProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ scenario?: string }>;
}) {
  const params = await searchParams;
  const scenario = parseDemoScenario(params.scenario);
  const dataset = buildDemoDataset(scenario);
  const { t } = await getTranslator("projects");

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <Button size="sm" disabled aria-disabled>
            <Plus className="mr-2 h-4 w-4" />
            {t("connectRepository")}
          </Button>
        }
      />

      {dataset.projects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={{ label: t("firstVerdictCta"), href: demoHref("/integrations", scenario) }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {dataset.projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              verdictStatus={
                (dataset.orgBrain.projects.find((item) => item.projectId === project.id)?.status ??
                  "insufficient_data") as VerdictStatus
              }
              detailHref={demoProjectPath(project.id, scenario)}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Demo mode —{" "}
        <Link href={demoHref("/", scenario)} className="text-primary hover:underline">
          switch scenario
        </Link>
      </p>
    </div>
  );
}
