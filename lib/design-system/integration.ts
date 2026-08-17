import { cn } from "@/lib/utils";

export type IntegrationConnectionState =
  | "connected"
  | "not_connected"
  | "warning"
  | "error"
  | "inactive";

export function integrationStatusClass(state: IntegrationConnectionState): string {
  switch (state) {
    case "connected":
      return "border-success/30 bg-success/5 text-success";
    case "warning":
      return "border-warning/30 bg-warning/5 text-warning";
    case "error":
      return "border-danger/30 bg-danger/5 text-danger";
    case "inactive":
    case "not_connected":
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

export function integrationStatusClasses(
  state: IntegrationConnectionState,
  className?: string
): string {
  return cn(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide",
    integrationStatusClass(state),
    className
  );
}
