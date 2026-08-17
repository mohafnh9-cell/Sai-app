import { cn } from "@/lib/utils";

export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
  variant = "default",
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  variant?: "default" | "danger";
}) {
  return (
    <section
      id={id}
      className={cn(
        "py-8 border-b border-border/50 last:border-b-0",
        variant === "danger" && "border-danger/20",
        className
      )}
    >
      <div className="mb-5">
        <h2
          className={cn(
            "text-sm font-semibold tracking-tight",
            variant === "danger" && "text-danger"
          )}
        >
          {title}
        </h2>
        {description ? (
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed max-w-xl">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
