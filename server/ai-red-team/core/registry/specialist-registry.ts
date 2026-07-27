import type { CoreSpecialist } from "../specialists/specialist.types";

export class CoreSpecialistRegistry implements import("../specialists/specialist.types").CoreSpecialistRegistryContract {
  private readonly specialists = new Map<string, CoreSpecialist>();

  register(specialist: CoreSpecialist): void {
    if (this.specialists.has(specialist.id)) {
      throw new Error(`Duplicate specialist: ${specialist.id}`);
    }
    this.specialists.set(specialist.id, specialist);
  }

  get(id: string): CoreSpecialist | null {
    return this.specialists.get(id) ?? null;
  }

  list(): CoreSpecialist[] {
    return [...this.specialists.values()].sort((a, b) => a.priority - b.priority);
  }
}

export function createCoreSpecialistRegistry(): CoreSpecialistRegistry {
  return new CoreSpecialistRegistry();
}
