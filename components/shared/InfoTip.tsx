"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Small inline "what does this mean" affordance for a stat/label -- click
 * (not hover) so it works the same on touch as on desktop, matching the
 * existing disclosure pattern in the app (CollapsibleSection) rather than
 * introducing a hover-tooltip dependency. Content is static, real product
 * copy explaining methodology -- never a place to surface data.
 */
export function InfoTip({
  label,
  title,
  body,
  className,
}: {
  label: string;
  title: string;
  body: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <span className="app-label-micro text-muted-foreground">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={title}
          className="rounded-sm px-0.5 text-[11px] leading-none text-muted-foreground/70 hover:text-primary seq-focus-ring"
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
      </div>
      {open ? (
        <div
          role="note"
          className={cn(
            "mt-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground"
          )}
        >
          <p className="mb-1 text-[13px] font-medium text-foreground">{title}</p>
          <p>{body}</p>
        </div>
      ) : null}
    </div>
  );
}
