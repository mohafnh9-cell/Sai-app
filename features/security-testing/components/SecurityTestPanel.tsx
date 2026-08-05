"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SecurityTestContext, SecurityTestOption } from "../types";
import type { ProjectReviewUiContext } from "@/server/projects/review-ui-context";
import { AnalyzeProjectScanContainer } from "@/features/projects/components/AnalyzeProjectScanContainer";
import { useI18n } from "@/lib/i18n/client";
import { PrimaryActionButton, SecurityTestHero } from "./SecurityTestHero";
import { DEFAULT_SECURITY_TEST_IDS } from "../user-test-catalog";
import { copyForPhase, safetyNote } from "../lib/product-copy";

function recommendedTestIds(tests: SecurityTestOption[]): string[] {
  const picked = tests.filter((test) => test.recommended).map((test) => test.id);
  if (picked.length > 0) return picked;
  return tests.slice(0, 4).map((test) => test.id);
}

export function SecurityTestPanel({
  projectId,
  context,
  reviewContext,
  compact = false,
}: {
  projectId: string;
  context: SecurityTestContext;
  reviewContext: ProjectReviewUiContext;
  compact?: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n("securityTest");
  const [chooseOpen, setChooseOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => recommendedTestIds(context.availableTests));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const screenCopy = copyForPhase(context.phase, t);

  const defaultTestIds = useMemo(
    () => recommendedTestIds(context.availableTests),
    [context.availableTests]
  );

  useEffect(() => {
    if (!context.reviewInProgress && context.phase !== "preparing") return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [context.phase, context.reviewInProgress, router]);

  const startTests = useCallback(
    async (testIds: string[]) => {
      setStarting(true);
      setError(null);
      try {
        const response = await fetch(`/api/projects/${projectId}/security-tests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testIds }),
        });
        const body = (await response.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          code?: string;
          attackCenterHref?: string;
        } | null;

        if (body?.code === "needs_review") {
          setError(t("customize.reviewFirst"));
          return;
        }

        if (!response.ok || !body?.ok) {
          setError(body?.error ?? t("errors.startFailed"));
          return;
        }

        router.push(body.attackCenterHref ?? context.attackCenterHref);
        router.refresh();
      } finally {
        setStarting(false);
        setChooseOpen(false);
      }
    },
    [context.attackCenterHref, projectId, router, t]
  );

  const toggleTest = (testId: string) => {
    setSelectedIds((current) =>
      current.includes(testId) ? current.filter((id) => id !== testId) : [...current, testId]
    );
  };

  const canCustomizeTests = context.phase === "ready";

  const primaryAction = (() => {
    if (context.phase === "preparing") {
      return (
        <PrimaryActionButton disabled size={compact ? "sm" : "lg"}>
          {screenCopy.primaryActionLabel}
        </PrimaryActionButton>
      );
    }

    if (context.phase === "needs_review") {
      return (
        <AnalyzeProjectScanContainer
          projectId={projectId}
          initialContext={reviewContext}
          showCommitHint={!compact}
          size={compact ? "sm" : "default"}
          className={compact ? undefined : "w-full sm:w-auto min-w-[220px] text-base h-11"}
          labelOverride={screenCopy.primaryActionLabel}
        />
      );
    }

    if (context.phase === "ready") {
      return (
        <PrimaryActionButton
          size={compact ? "sm" : "lg"}
          loading={starting}
          disabled={context.reviewInProgress}
          onClick={() => void startTests(defaultTestIds)}
        >
          {screenCopy.primaryActionLabel}
        </PrimaryActionButton>
      );
    }

    if (
      context.phase === "running" ||
      context.phase === "issues_found" ||
      context.phase === "fix_ready"
    ) {
      return (
        <PrimaryActionButton
          size={compact ? "sm" : "lg"}
          onClick={() => router.push(context.attackCenterHref)}
        >
          {screenCopy.primaryActionLabel}
        </PrimaryActionButton>
      );
    }

    if (context.phase === "protected" || context.phase === "completed_clean") {
      return (
        <PrimaryActionButton
          size={compact ? "sm" : "lg"}
          onClick={() => router.push(context.attackCenterHref)}
        >
          {screenCopy.primaryActionLabel}
        </PrimaryActionButton>
      );
    }

    return null;
  })();

  return (
    <>
      <SecurityTestHero
        compact={compact}
        headline={screenCopy.headline}
        description={screenCopy.description}
        progressSteps={context.progressSteps}
        waitMessage={screenCopy.waitMessage}
        showEstimatedDuration={screenCopy.showEstimatedDuration}
        showSafetyNote={screenCopy.showSafetyNote}
        primaryAction={
          <>
            {error ? <p className="text-sm text-destructive mb-3">{error}</p> : null}
            {primaryAction}
            {canCustomizeTests ? (
              <button
                type="button"
                className="block mt-3 text-sm text-muted-foreground underline-offset-4 hover:underline hover:text-foreground"
                disabled={starting || context.reviewInProgress}
                onClick={() => {
                  setSelectedIds(defaultTestIds);
                  setChooseOpen(true);
                }}
              >
                {t("customize.link")}
              </button>
            ) : null}
          </>
        }
      />

      <Dialog open={chooseOpen} onOpenChange={setChooseOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("customize.title")}</DialogTitle>
            <DialogDescription>
              {t("customize.description")} {safetyNote(t)}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-3 py-2">
            {context.availableTests.map((test) => {
              const checked = selectedIds.includes(test.id);
              return (
                <li key={test.id}>
                  <label className="flex cursor-pointer gap-3 rounded-xl border border-border/60 p-4 hover:bg-accent/20">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={() => toggleTest(test.id)}
                    />
                    <span className="space-y-1">
                      <span className="block font-medium">{test.title}</span>
                      <span className="block text-sm text-muted-foreground">{test.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSelectedIds(DEFAULT_SECURITY_TEST_IDS.slice() as unknown as string[])}
            >
              {t("customize.useRecommended")}
            </Button>
            <Button
              type="button"
              disabled={selectedIds.length === 0 || starting}
              onClick={() => void startTests(selectedIds)}
            >
              {starting ? t("customize.starting") : t("customize.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
