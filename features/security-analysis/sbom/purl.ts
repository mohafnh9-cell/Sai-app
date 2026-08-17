import type { SbomEcosystem } from "./types";

const ECOSYSTEM_TO_PURL_TYPE: Record<SbomEcosystem, string> = {
  npm: "npm",
  pypi: "pypi",
  rubygems: "gem",
  crates: "cargo",
  go: "golang",
  java: "maven",
};

export function buildPurl(input: {
  ecosystem: SbomEcosystem;
  name: string;
  version?: string;
  namespace?: string;
}): string {
  const type = ECOSYSTEM_TO_PURL_TYPE[input.ecosystem] ?? input.ecosystem;
  if (!input.name) return "";

  let qualifiedName: string;
  if (type === "npm" && input.name.startsWith("@")) {
    const [scope, pkg] = input.name.split("/");
    qualifiedName = `${encodeURIComponent(scope)}/${pkg}`;
  } else if (type === "maven" && input.namespace) {
    qualifiedName = `${input.namespace}/${input.name}`;
  } else if (type === "golang") {
    qualifiedName = input.name;
  } else {
    qualifiedName = input.name;
  }

  const version = input.version?.trim();
  return version ? `pkg:${type}/${qualifiedName}@${version}` : `pkg:${type}/${qualifiedName}`;
}

export function packageIdentity(input: {
  ecosystem: SbomEcosystem;
  name: string;
  version: string;
  namespace?: string;
  purl?: string;
}): string {
  if (input.purl) return input.purl;
  if (input.namespace) {
    return `${input.ecosystem}:${input.namespace}:${input.name}@${input.version}`;
  }
  return `${input.ecosystem}:${input.name}@${input.version}`;
}
