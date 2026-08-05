"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AnalyzeProjectButton({
  label,
  loading,
  disabled,
  progress,
  onClick,
  className,
  size = "default",
  variant = "default",
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  progress: string | null;
  onClick: () => void;
  className?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "destructive" | "secondary" | "outline" | "ghost" | "link";
}) {
  return (
    <div>
      <Button
        type="button"
        onClick={onClick}
        disabled={disabled}
        size={size}
        variant={variant}
        className={className}
        aria-busy={loading}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
        {label}
      </Button>
      {progress ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          {progress}
        </p>
      ) : null}
    </div>
  );
}
