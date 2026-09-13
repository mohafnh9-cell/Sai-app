"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";

export default function ScannerResultDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n("scannerResults");

  useEffect(() => {
    console.error({
      component: "scanner-result-detail-error-boundary",
      name: error.name,
      message: error.message,
      digest: error.digest ?? null,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-8 py-16 flex flex-col items-center text-center gap-4">
      <h1 className="text-xl font-semibold tracking-tight">{t("loadErrorTitle")}</h1>
      <p className="text-sm text-muted-foreground max-w-sm">{t("loadErrorBody")}</p>
      <div className="flex gap-3 pt-2">
        <Button onClick={() => reset()}>{t("tryAgain")}</Button>
        <Button variant="outline" asChild>
          <Link href="/scanner-results">{t("backToResults")}</Link>
        </Button>
      </div>
    </div>
  );
}
