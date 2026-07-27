import type { PreferredAI } from "../uee.types";
import { SUPPORTED_PREFERRED_AIS } from "../uee.types";

export function resolvePreferredAI(input: {
  preferredAI?: PreferredAI | null;
  environmentPreferred?: string | null;
}): PreferredAI {
  const raw = (input.preferredAI ?? input.environmentPreferred ?? "cursor").toLowerCase().replace(/-/g, "_");
  if (SUPPORTED_PREFERRED_AIS.includes(raw as PreferredAI)) {
    return raw as PreferredAI;
  }
  return "cursor";
}

export function isValidPreferredAI(value: string): value is PreferredAI {
  return SUPPORTED_PREFERRED_AIS.includes(value as PreferredAI);
}
