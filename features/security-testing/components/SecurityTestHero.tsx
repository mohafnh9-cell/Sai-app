"use client";

import type { ReactNode } from "react";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import { SecurityTestProgressSteps } from "./SecurityTestProgressSteps";
import { estimatedTestDuration, safetyNote } from "../lib/product-copy";
import type { SecurityTestProgressStep } from "../types";

export function SecurityTestHero({
  headline,
  description,
  progressSteps,
  primaryAction,
  waitMessage,
  showEstimatedDuration = false,
  showSafetyNote = false,
  compact = false,
}: {
  headline: string;
  description: string;
  progressSteps: SecurityTestProgressStep[];
  primaryAction: ReactNode;
  waitMessage?: string | null;
  showEstimatedDuration?: boolean;
  showSafetyNote?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n("securityTest");

  return (
    <section
      className={
        compact
          ? "space-y-5"
          : "rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 space-y-6"
      }
    >
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-primary/10 p-3 text-primary shrink-0">
          <Shield className="h-5 w-5" />
        </div>
        <div className="space-y-2 min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-primary">{t("title")}</p>
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">{headline}</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">{description}</p>
        </div>
      </div>

      {showEstimatedDuration || showSafetyNote ? (
        <div className="rounded-xl border border-border/50 bg-muted/10 px-4 py-3 text-sm text-muted-foreground space-y-1">
          {showEstimatedDuration ? (
            <p>
              <span className="font-medium text-foreground">{t("estimatedTime")}</span>{" "}
              {estimatedTestDuration(t)}
            </p>
          ) : null}
          {showSafetyNote ? <p>{safetyNote(t)}</p> : null}
        </div>
      ) : null}

      <SecurityTestProgressSteps steps={progressSteps} />

      {waitMessage ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          <span>{waitMessage}</span>
        </div>
      ) : null}

      <div className="space-y-3">
        <div className={compact ? "" : "max-w-md"}>{primaryAction}</div>
      </div>
    </section>
  );
}

export function PrimaryActionButton({
  children,
  disabled,
  loading,
  onClick,
  size = "default",
  className,
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  size?: "default" | "sm" | "lg";
  className?: string;
}) {
  return (
    <Button
      type="button"
      size={size === "default" ? "lg" : size}
      disabled={disabled || loading}
      onClick={onClick}
      className={className ?? "w-full sm:w-auto min-w-[220px] text-base"}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
      {children}
    </Button>
  );
}
