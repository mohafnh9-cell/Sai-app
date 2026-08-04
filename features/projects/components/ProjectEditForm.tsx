"use client";

import { useRouter } from "next/navigation";
import { useUpdateProject } from "@/hooks/use-projects";
import { ProjectForm } from "./ProjectForm";
import type { ProjectRow } from "@/types/database";
import type { ProjectFormValues } from "@/features/projects/schemas/project.schema";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

interface ProjectEditFormProps {
  project: ProjectRow;
}

export function ProjectEditForm({ project }: ProjectEditFormProps) {
  const router = useRouter();
  const { mutateAsync: updateProject, isPending } = useUpdateProject();

  const handleSubmit = async (values: ProjectFormValues) => {
    await updateProject({
      id: project.id,
      payload: {
        name: values.name,
        description: values.description ?? null,
        github_repo: values.github_repo ?? null,
        production_url: values.production_url ?? null,
        framework: (values.framework as ProjectRow["framework"]) ?? null,
      },
    });
    router.push(projectVerdictHref(project.id));
  };

  return (
    <ProjectForm
      defaultValues={project}
      onSubmit={handleSubmit}
      isLoading={isPending}
      submitLabel="Save changes"
      onCancel={() => router.push(projectVerdictHref(project.id))}
    />
  );
}
