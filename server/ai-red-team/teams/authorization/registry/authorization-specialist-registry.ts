import type { AuthorizationSpecialist } from "../authorization-team.types";

export class AuthorizationSpecialistRegistry {
  private readonly specialists = new Map<string, AuthorizationSpecialist>();

  register(specialist: AuthorizationSpecialist): void {
    this.specialists.set(specialist.id, specialist);
  }

  registerMany(specialists: AuthorizationSpecialist[]): void {
    for (const s of specialists) this.register(s);
  }

  listAll(): AuthorizationSpecialist[] {
    return [...this.specialists.values()].sort((a, b) => a.priority - b.priority);
  }
}

export function createAuthorizationSpecialistRegistry(
  specialists: AuthorizationSpecialist[]
): AuthorizationSpecialistRegistry {
  const registry = new AuthorizationSpecialistRegistry();
  registry.registerMany(specialists);
  return registry;
}
