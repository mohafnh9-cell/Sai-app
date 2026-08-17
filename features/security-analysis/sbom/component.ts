import { buildPurl } from "./purl";
import type { SbomComponent, SbomEcosystem } from "./types";

export function createSbomComponent(input: {
  name: string;
  version?: string;
  ecosystem: SbomEcosystem;
  isDev?: boolean;
  isDirect?: boolean;
  namespace?: string;
  lockfilePath?: string;
}): SbomComponent {
  const version = input.version?.trim() || "unknown";
  return {
    name: input.name,
    version,
    ecosystem: input.ecosystem,
    isDev: input.isDev ?? false,
    isDirect: input.isDirect ?? false,
    namespace: input.namespace,
    lockfilePath: input.lockfilePath,
    purl: buildPurl({
      ecosystem: input.ecosystem,
      name: input.name,
      version,
      namespace: input.namespace,
    }),
  };
}
