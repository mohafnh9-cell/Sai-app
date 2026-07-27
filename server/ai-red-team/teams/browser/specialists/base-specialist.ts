import type {
  BrowserScenario,
  BrowserSpecialist,
  BrowserSpecialistResult,
  BrowserTeamContext,
} from "../browser-team.types";
import type { SafeBrowserRuntime } from "../runtime/safe-browser-runtime";

export abstract class BaseBrowserSpecialist implements BrowserSpecialist {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly priority: number;
  abstract readonly capabilities: BrowserSpecialist["capabilities"];
  abstract readonly supportedEnvironments: BrowserSpecialist["supportedEnvironments"];

  canRun(_context: BrowserTeamContext): boolean {
    return true;
  }

  abstract plan(context: BrowserTeamContext): Promise<BrowserScenario[]>;
  abstract execute(
    runtime: SafeBrowserRuntime,
    scenario: BrowserScenario,
    context: BrowserTeamContext
  ): Promise<BrowserSpecialistResult>;
}
