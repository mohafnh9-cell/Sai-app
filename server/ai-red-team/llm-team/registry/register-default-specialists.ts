import { createDefaultAiSecuritySpecialists } from "../specialists/default-specialist-pack";
import { createAiSpecialistRegistry } from "./ai-specialist-registry";

export function createDefaultAiSpecialistRegistry() {
  return createAiSpecialistRegistry(createDefaultAiSecuritySpecialists());
}

export function registerDefaultAiSpecialists(registry: import("./ai-specialist-registry").AISpecialistRegistry) {
  registry.registerMany(createDefaultAiSecuritySpecialists());
}
