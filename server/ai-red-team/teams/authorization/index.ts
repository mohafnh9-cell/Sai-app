export * from "./authorization-team.types";
export * from "./authorization-team-coordinator";
export * from "./authorization-team-agent";
export {
  createAuthorizationSpecialistRegistry,
  AuthorizationSpecialistRegistry,
} from "./registry/authorization-specialist-registry";
export { createDefaultAuthorizationSpecialists } from "./registry/register-default-authorization-specialists";
export { buildRoleGraph } from "./model/role-graph";
export { buildResourceGraph } from "./model/resource-graph";
export { buildAuthorizationMatrix, matrixSize, buildScaledAuthorizationMatrix, evaluateMatrixSample } from "./model/authorization-matrix";
export { dedupeAuthzFindings, validateAuthzFinding, confirmReplayFindings } from "./findings/authorization-finding-validator";
export { detectAuthorizationSignals } from "./discovery/authz-discovery";
