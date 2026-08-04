import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectEditForm } from "@/features/projects/components/ProjectEditForm";
import type { ProjectRow } from "@/types/database";
import { projectVerdictHref } from "@/lib/navigation/project-hrefs";

interface EditProjectPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: EditProjectPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("projects").select("name").eq("id", id).single();
  return { title: `Edit ${data?.name ?? "Project"}` };
}

export default async function EditProjectPage({ params }: EditProjectPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: project, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !project) notFound();

  const p = project as ProjectRow;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="gap-1.5 -ml-1">
        <Link href={projectVerdictHref(p.id)}>
          <ArrowLeft className="h-4 w-4" />
          Back to project
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit project</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Update the details for <span className="font-medium">{p.name}</span>.
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Project details</CardTitle>
          <CardDescription>Update name, description, framework, or URLs.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectEditForm project={p} />
        </CardContent>
      </Card>
    </div>
  );
}
