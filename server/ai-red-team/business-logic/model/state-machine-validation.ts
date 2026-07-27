import type { BusinessStateMachine, StateMachineValidationIssue } from "./domain.types";

export function validateStateMachine(machine: BusinessStateMachine): StateMachineValidationIssue[] {
  const issues: StateMachineValidationIssue[] = [];
  const stateIds = new Set(machine.states.map((s) => s.id));

  if (machine.terminalStateIds.length === 0) {
    issues.push({
      code: "missing_terminal_state",
      stateMachineId: machine.id,
      message: "State machine has no terminal states.",
    });
  }

  for (const terminalId of machine.terminalStateIds) {
    if (!stateIds.has(terminalId)) {
      issues.push({
        code: "missing_terminal_state",
        stateMachineId: machine.id,
        message: `Terminal state id not found: ${terminalId}`,
        stateId: terminalId,
      });
    }
  }

  const reachable = computeReachable(machine);
  for (const state of machine.states) {
    if (!reachable.has(state.id)) {
      issues.push({
        code: "unreachable_state",
        stateMachineId: machine.id,
        message: `State "${state.name}" is unreachable from initial state.`,
        stateId: state.id,
      });
    }
  }

  if (!reachable.has(machine.initialStateId)) {
    issues.push({
      code: "missing_initial_reachability",
      stateMachineId: machine.id,
      message: "Initial state is missing from state list.",
      stateId: machine.initialStateId,
    });
  }

  const transitionKeys = new Set<string>();
  for (const transition of machine.transitions) {
    const key = `${transition.fromStateId}|${transition.toStateId}|${transition.event}`;
    if (transitionKeys.has(key)) {
      issues.push({
        code: "duplicate_transition",
        stateMachineId: machine.id,
        message: `Duplicate transition on event "${transition.event}" from ${transition.fromStateId} to ${transition.toStateId}.`,
        transitionId: transition.id,
      });
    }
    transitionKeys.add(key);

    if (!stateIds.has(transition.fromStateId) || !stateIds.has(transition.toStateId)) {
      issues.push({
        code: "invalid_ordering_hint",
        stateMachineId: machine.id,
        message: `Transition references unknown state: ${transition.fromStateId} -> ${transition.toStateId}`,
        transitionId: transition.id,
      });
    }

    if (transition.rollbackTargetStateId && !stateIds.has(transition.rollbackTargetStateId)) {
      issues.push({
        code: "invalid_rollback_target",
        stateMachineId: machine.id,
        message: `Rollback target state not found: ${transition.rollbackTargetStateId}`,
        transitionId: transition.id,
        stateId: transition.rollbackTargetStateId,
      });
    }
  }

  for (const state of machine.states) {
    if (state.kind !== "error" && state.ownerActorId == null) {
      issues.push({
        code: "missing_ownership",
        stateMachineId: machine.id,
        message: `State "${state.name}" has no owning actor assigned.`,
        stateId: state.id,
      });
    }
  }

  validateOrderingHints(machine, issues);

  return issues;
}

function computeReachable(machine: BusinessStateMachine): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const t of machine.transitions) {
    const list = adjacency.get(t.fromStateId) ?? [];
    list.push(t.toStateId);
    adjacency.set(t.fromStateId, list);
  }

  const visited = new Set<string>();
  const queue = [machine.initialStateId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) queue.push(next);
    }
  }
  return visited;
}

function validateOrderingHints(
  machine: BusinessStateMachine,
  issues: StateMachineValidationIssue[]
): void {
  const happyPathTag = machine.metadata.tags.find((t) => t.startsWith("happy_path:"));
  if (!happyPathTag) return;

  const segments = happyPathTag.replace("happy_path:", "").split(">");
  for (let i = 0; i < segments.length - 1; i += 1) {
    const from = segments[i];
    const to = segments[i + 1];
    const hasForward = machine.transitions.some((t) => t.fromStateId === from && t.toStateId === to);
    if (!hasForward) {
      issues.push({
        code: "invalid_ordering_hint",
        stateMachineId: machine.id,
        message: `Expected ordering transition missing: ${from} -> ${to}`,
        stateId: from,
      });
    }
  }
}

export function validateStateMachines(machines: BusinessStateMachine[]): StateMachineValidationIssue[] {
  return machines.flatMap((m) => validateStateMachine(m));
}
