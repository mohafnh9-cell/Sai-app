import { redirect } from "next/navigation";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/shared/PageHeader";
import { UploadDropzone } from "@/features/upload/components/UploadDropzone";
import { LocalAnalysisPicker } from "@/features/upload/components/LocalAnalysisPicker";
import { getCachedServerAuthContext } from "@/lib/server/request-cache";
import { getTranslator } from "@/lib/i18n/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator("upload");
  return { title: t("pageTitle") };
}

export default async function AnalyzeCodePage() {
  const auth = await getCachedServerAuthContext();
  if (!auth) redirect("/login");
  if (!auth.organizationId) redirect("/onboarding");

  const { t } = await getTranslator("upload");

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-2xl px-4 sm:px-8 py-8 sm:py-12 space-y-8">
        <PageHeader title={t("pageTitle")} description={t("pageSubtitle")} />

        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <GitBranch className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">{t("githubOption.title")}</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("githubOption.description")}
              </p>
            </div>
          </div>
          <Button asChild className="w-full sm:w-auto">
            <Link href="/integrations">{t("githubOption.cta")}</Link>
          </Button>
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight">{t("uploadOption.title")}</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("uploadOption.description")}
          </p>
          <UploadDropzone />
        </div>

        <Separator />

        <div className="space-y-3">
          <h2 className="text-sm font-semibold tracking-tight">{t("localOption.title")}</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("localOption.description")}
          </p>
          <LocalAnalysisPicker />
        </div>
      </div>
    </div>
  );
}
