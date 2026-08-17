export type SbomEcosystem = "npm" | "pypi" | "crates" | "go" | "rubygems" | "java";

export type SbomComponent = {
  name: string;
  version: string;
  ecosystem: SbomEcosystem;
  purl: string;
  namespace?: string;
  isDev?: boolean;
  isDirect?: boolean;
  lockfilePath?: string;
};

export type SbomSnapshot = {
  components: SbomComponent[];
  metadata: {
    name: string;
    version: string;
    ecosystems: SbomEcosystem[];
    total: number;
    direct: number;
    dev: number;
    lockfiles: string[];
  };
};

export type RepositoryFile = {
  path: string;
  content: string;
};
