import type { AISecuritySpecialist } from "../specialists/specialist.types";

export class AISpecialistRegistry {
  private readonly specialists = new Map<string, AISecuritySpecialist>();

  register(specialist: AISecuritySpecialist): void {
    if (this.specialists.has(specialist.id)) {
      throw new Error(`AI security specialist already registered: ${specialist.id}`);
    }
    this.specialists.set(specialist.id, specialist);
  }

  registerMany(specialists: AISecuritySpecialist[]): void {
    for (const specialist of specialists) {
      this.register(specialist);
    }
  }

  listAll(): AISecuritySpecialist[] {
    return [...this.specialists.values()].sort((a, b) => a.priority - b.priority);
  }

  selectEligible(context: import("../specialists/specialist.types").AISpecialistContext): AISecuritySpecialist[] {
    return this.listAll().filter((s) => {
      const eligibility = s.canRun(context);
      if (eligibility instanceof Promise) {
        throw new Error(
          `AISpecialistRegistry.selectEligible is synchronous; specialist ${s.id} returned a Promise from canRun`,
        );
      }
      return eligibility.eligible;
    });
  }
}

export function createAiSpecialistRegistry(
  specialists: AISecuritySpecialist[]
): AISpecialistRegistry {
  const registry = new AISpecialistRegistry();
  registry.registerMany(specialists);
  return registry;
}

export const AISpecialistRegistryFactory = {
  create: createAiSpecialistRegistry,
};
