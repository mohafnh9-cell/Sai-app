"use client";

import { useCallback, useState } from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { cancelReviewMessageKey } from "@/lib/review/cancel-errors";

export function CancelReviewDialog({
  projectId,
  scanJobId,
  reviewId,
  open,
  onOpenChange,
  onCancelling,
  onCancelled,
  onError,
  onStale,
}: {
  projectId: string;
  scanJobId: string | null;
  reviewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCancelling: () => void;
  onCancelled: () => void;
  onError: (message: string) => void;
  onStale?: () => void;
}) {
  const { t } = useI18n("projects");
  const [submitting, setSubmitting] = useState(false);

  const confirmCancel = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    onCancelling();
    try {
      const url = scanJobId
        ? `/api/projects/${projectId}/scan-jobs/${scanJobId}/cancel`
        : `/api/projects/${projectId}/reviews/${reviewId}/cancel`;
      const response = await fetch(url, { method: "POST" });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
      } | null;
      if (!response.ok) {
        const key = cancelReviewMessageKey(body?.code);
        onError(t(key));
        if (body?.code === "STALE_REVIEW") {
          onStale?.();
        }
        onOpenChange(false);
        return;
      }
      onOpenChange(false);
      onCancelled();
    } catch {
      onError(t("cancelReviewError"));
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }, [
    onCancelled,
    onCancelling,
    onError,
    onOpenChange,
    onStale,
    projectId,
    reviewId,
    scanJobId,
    submitting,
    t,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("cancelReviewDialogTitle")}</DialogTitle>
          <DialogDescription>{t("cancelReviewDialogDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancelReviewDialogDismiss")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={() => void confirmCancel()}
          >
            {t("cancelReviewDialogConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CancelReviewButton({
  projectId,
  scanJobId,
  reviewId,
  disabled,
  onCancelling,
  onCancelled,
  onError,
  onStale,
}: {
  projectId: string;
  scanJobId: string | null;
  reviewId: string;
  disabled?: boolean;
  onCancelling: () => void;
  onCancelled: () => void;
  onError: (message: string) => void;
  onStale?: () => void;
}) {
  const { t } = useI18n("projects");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="default"
        className="mt-2"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <XCircle className="mr-2 h-4 w-4" />
        {t("cancelReview")}
      </Button>
      <CancelReviewDialog
        projectId={projectId}
        scanJobId={scanJobId}
        reviewId={reviewId}
        open={open}
        onOpenChange={setOpen}
        onCancelling={onCancelling}
        onCancelled={onCancelled}
        onError={onError}
        onStale={onStale}
      />
    </>
  );
}
