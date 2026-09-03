import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Small caps label above the title (e.g. "Production Intelligence"). */
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  secondaryAction,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div>
        {eyebrow && <p className="text-eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight leading-none">{title}</h1>
        {description && (
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed max-w-2xl">{description}</p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="flex shrink-0 items-center gap-2">
          {secondaryAction}
          {action}
        </div>
      )}
    </div>
  );
}
