import { randomUUID } from "node:crypto";
import type { BusinessLogicTeamContext } from "../discovery/discovery.types";
import type { BusinessDomainModel, BusinessExecutionPath, BusinessWorkflowGraph } from "./domain.types";
import { normalizeDiscoveredEntities } from "./normalize-entity";
import { attachStepsFromStateMachine, normalizeDiscoveredWorkflow } from "./normalize-workflow";
import {
  buildStateMachineForWorkflow,
  primaryHappyPathStateIds,
  stateLabelMap,
} from "./state-machine";
import { validateStateMachines } from "./state-machine-validation";
import { mergeEvidence } from "./evidence";

export function buildBusinessDomainModel(context: BusinessLogicTeamContext): BusinessDomainModel {
  const entities = normalizeDiscoveredEntities(context.entities);
  const stateMachines = [];
  const workflows = [];

  for (const discovered of context.workflows) {
    const machine = buildStateMachineForWorkflow(discovered, null);
    const happyPath = primaryHappyPathStateIds(discovered.kind);
    machine.metadata.tags.push(`happy_path:${happyPath.join(">")}`);

    let workflow = normalizeDiscoveredWorkflow(discovered, entities, machine.id);
    const ownerActorId = workflow.actors[0]?.id ?? null;
    applyActorOwnership(machine, ownerActorId);

    workflow = attachStepsFromStateMachine(
      workflow,
      happyPath,
      stateLabelMap(machine),
      discovered.evidence
    );

    machine.workflowId = workflow.id;
    stateMachines.push(machine);
    workflows.push(workflow);
  }

  const validationIssues = validateStateMachines(stateMachines);
  const workflowGraph = buildWorkflowGraph(workflows, entities, stateMachines);

  return {
    entities,
    workflows,
    stateMachines,
    workflowGraph,
    validationIssues,
  };
}

function buildWorkflowGraph(
  workflows: BusinessDomainModel["workflows"],
  entities: BusinessDomainModel["entities"],
  machines: BusinessDomainModel["stateMachines"]
): BusinessWorkflowGraph {
  const relationships = entities.flatMap((e) => e.relationships);
  const executionPaths: BusinessExecutionPath[] = machines.map((machine) => {
    const happyTag = machine.metadata.tags.find((t) => t.startsWith("happy_path:"));
    const stateIds = happyTag
      ? happyTag.replace("happy_path:", "").split(">")
      : [machine.initialStateId];
    return {
      id: randomUUID(),
      stateMachineId: machine.id,
      stateIds,
      label: `Happy path — ${machine.label}`,
    };
  });

  return {
    workflowIds: workflows.map((w) => w.id),
    entityIds: entities.map((e) => e.id),
    relationships,
    executionPaths,
  };
}

export { mergeEvidence };

function applyActorOwnership(machine: import("./domain.types").BusinessStateMachine, ownerActorId: string | null): void {
  for (const state of machine.states) {
    if (state.kind !== "error") {
      state.ownerActorId = ownerActorId;
    }
  }
  for (const transition of machine.transitions) {
    transition.actorId = ownerActorId;
  }
}
