import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProjectCard } from "@/features/projects/components/ProjectCard";
import { buildOrgBrain } from "@/server/brain/build-org-brain";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import type { ProjectRow } from "@/types/database";
import type { VerdictStatus } from "@/brain/production-verdict/schema";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator("projects");
  return { title: t("title") };
}

export default async function ProjectsPage() {
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  if (!auth.organizationId) redirect("/onboarding");

  const { t } = await getTranslator("projects");

  const [{ data: projects }, brain] = await Promise.all([
    auth.supabase
      .from("projects")
      .select("*")
      .eq("organization_id", auth.organizationId)
      .order("created_at", { ascending: false }),
    buildOrgBrain(auth.supabase, auth.organizationId),
  ]);

  const statusByProject = new Map(
    brain.projects.map((item) => [item.projectId, item.status])
  );

  const projectList = (projects ?? []) as ProjectRow[];

  return (
    <div className="app-cinematic-bg min-h-full">
      <div className="mx-auto max-w-5xl px-4 sm:px-8 py-10 sm:py-14 space-y-10">
      <PageHeader
        title={t("title")}
        description={t("subtitle", { count: projectList.length })}
        action={
          <Button size="sm" className="rounded-xl" asChild>
            <Link href="/integrations">
              <Plus className="mr-2 h-4 w-4" />
              {t("connectRepository")}
            </Link>
          </Button>
        }
      />

      {projectList.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title={t("noProjectsTitle")}
          description={t("noProjectsBody")}
          action={{ label: t("connectRepository"), href: "/integrations" }}
          className="py-20"
        />
      ) : (
        <div className="space-y-3 max-w-2xl">
          {projectList.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              verdictStatus={(statusByProject.get(project.id) ?? "insufficient_data") as VerdictStatus}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
