import type { BrowserSpecialist } from "./browser-team.types";

export class BrowserSpecialistRegistry {
  private readonly specialists = new Map<string, BrowserSpecialist>();

  register(specialist: BrowserSpecialist): void {
    if (this.specialists.has(specialist.id)) {
      throw new Error(`Browser specialist already registered: ${specialist.id}`);
    }
    this.specialists.set(specialist.id, specialist);
  }

  registerMany(specialists: BrowserSpecialist[]): void {
    for (const specialist of specialists) {
      this.register(specialist);
    }
  }

  listAll(): BrowserSpecialist[] {
    return [...this.specialists.values()].sort((a, b) => a.priority - b.priority);
  }

  getById(id: string): BrowserSpecialist | undefined {
    return this.specialists.get(id);
  }
}

export function createBrowserSpecialistRegistry(
  specialists: BrowserSpecialist[] = []
): BrowserSpecialistRegistry {
  const registry = new BrowserSpecialistRegistry();
  if (specialists.length > 0) registry.registerMany(specialists);
  return registry;
}
