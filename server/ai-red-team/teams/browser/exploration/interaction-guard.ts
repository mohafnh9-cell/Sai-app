import { isDestructiveActionHint } from "../../../authorization";

export function isPathExcluded(path: string, exclusions: string[]): boolean {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return exclusions.some((ex) => normalized === ex || normalized.startsWith(`${ex}/`));
}

export function guardInteraction(input: {
  path?: string;
  method?: string;
  label?: string;
}): { allowed: boolean; reason?: string } {
  if (isDestructiveActionHint(input)) {
    return { allowed: false, reason: "potentially_destructive" };
  }
  return { allowed: true };
}
