import "server-only";

import type { SecurityEngine } from "./types";
import { createOpenGrepEngine } from "./opengrep/engine";
import { createTrivyEngine } from "./trivy/engine";
import { createCryptoEngine } from "./crypto/engine";
import { createScorecardEngine } from "./scorecard/engine";

/**
 * Phase 35, section 19: the capability registry Phase 36's planner will
 * consume. Deliberately excludes the "native" 47-rule scanner as a
 * SecurityEngine implementation -- that scanner is untouched by this phase
 * (per the brief's "do not rewrite the existing 47-rule scanner") and keeps
 * running through its own existing pipeline; its results are merged in
 * alongside these engines' output at the orchestration layer, not re-modeled
 * here.
 */
export function listExternalAndNativeAdjacentEngines(): SecurityEngine[] {
  return [createOpenGrepEngine(), createTrivyEngine(), createCryptoEngine(), createScorecardEngine()];
}

export { createOpenGrepEngine, createTrivyEngine, createCryptoEngine, createScorecardEngine };
