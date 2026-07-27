import type { BusinessLogicSpecialist } from "../specialists/specialist.types";

export class BusinessLogicSpecialistRegistry {
  private readonly specialists = new Map<string, BusinessLogicSpecialist>();

  register(specialist: BusinessLogicSpecialist): void {
    if (this.specialists.has(specialist.id)) {
      throw new Error(`Business logic specialist already registered: ${specialist.id}`);
    }
    this.specialists.set(specialist.id, specialist);
  }

  registerMany(specialists: BusinessLogicSpecialist[]): void {
    for (const specialist of specialists) this.register(specialist);
  }

  listAll(): BusinessLogicSpecialist[] {
    return [...this.specialists.values()].sort((a, b) => a.priority - b.priority);
  }
}

export function createBusinessLogicSpecialistRegistry(
  specialists: BusinessLogicSpecialist[]
): BusinessLogicSpecialistRegistry {
  const registry = new BusinessLogicSpecialistRegistry();
  registry.registerMany(specialists);
  return registry;
}
