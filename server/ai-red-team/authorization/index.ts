export type {
  AttackAuthorizationRecord,
  AttackEnvironmentType,
  AuthorizationValidationResult,
} from "./types";
export {
  normalizeOrigin,
  isOriginAllowed,
  validateAttackAuthorization,
  isDestructiveActionHint,
} from "./types";
export { getActiveAttackAuthorization, createAttackAuthorization } from "./store";
