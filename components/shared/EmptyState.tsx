import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick?: () => void;
    href?: string;
  };
  variant?: "default" | "success";
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed py-14 px-6 text-center",
        variant === "success"
          ? "border-green-500/20 bg-green-500/5"
          : "border-border",
        className
      )}
    >
      {Icon && (
        <div
          className={cn(
            "mb-4 flex h-12 w-12 items-center justify-center rounded-xl",
            variant === "success" ? "bg-green-500/10" : "bg-secondary"
          )}
        >
          <Icon
            className={cn(
              "h-6 w-6",
              variant === "success" ? "text-green-500" : "text-muted-foreground"
            )}
            aria-hidden
          />
        </div>
      )}
      <h3
        className={cn(
          "text-sm font-semibold",
          variant === "success" ? "text-green-600" : "text-foreground"
        )}
      >
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 text-sm text-muted-foreground max-w-xs">{description}</p>
      )}
      {action && (
        <div className="mt-5">
          {action.href ? (
            <Button size="sm" asChild>
              <a href={action.href}>{action.label}</a>
            </Button>
          ) : (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
