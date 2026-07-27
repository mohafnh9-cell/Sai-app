import type { ApiSpecialist } from "../api-team.types";

export class ApiSpecialistRegistry {
  private readonly specialists = new Map<string, ApiSpecialist>();

  register(specialist: ApiSpecialist): void {
    if (this.specialists.has(specialist.id)) {
      throw new Error(`API specialist already registered: ${specialist.id}`);
    }
    this.specialists.set(specialist.id, specialist);
  }

  registerMany(specialists: ApiSpecialist[]): void {
    for (const s of specialists) this.register(s);
  }

  listAll(): ApiSpecialist[] {
    return [...this.specialists.values()].sort((a, b) => a.priority - b.priority);
  }
}

export function createApiSpecialistRegistry(specialists: ApiSpecialist[] = []): ApiSpecialistRegistry {
  const registry = new ApiSpecialistRegistry();
  if (specialists.length) registry.registerMany(specialists);
  return registry;
}
