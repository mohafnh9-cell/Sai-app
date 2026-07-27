import type { AuthzAction } from "../authorization-team.types";
import type { AuthorizationRoleGraph } from "./role-graph";
import type { AuthorizationResourceGraph } from "./resource-graph";

export type MatrixCellState = "allowed" | "denied" | "unknown" | "untested";

export type AuthorizationMatrixCell = {
  roleId: string;
  resourceId: string;
  action: AuthzAction;
  state: MatrixCellState;
};

export type AuthorizationMatrix = {
  cells: AuthorizationMatrixCell[];
};

const BASE_ACTIONS: AuthzAction[] = ["read", "write", "update", "delete", "manage"];

export function buildAuthorizationMatrix(
  roles: AuthorizationRoleGraph,
  resources: AuthorizationResourceGraph
): AuthorizationMatrix {
  const cells: AuthorizationMatrixCell[] = [];
  for (const role of roles.nodes) {
    for (const res of resources.nodes) {
      for (const action of BASE_ACTIONS) {
        cells.push({
          roleId: role.id,
          resourceId: res.id,
          action,
          state: inferCellState(role.id, res.id, action),
        });
      }
    }
  }
  return { cells };
}

function inferCellState(roleId: string, resourceId: string, action: AuthzAction): MatrixCellState {
  if (roleId === "anonymous" && resourceId === "admin_panel") return "denied";
  if (roleId === "anonymous") return action === "read" ? "unknown" : "denied";
  if (roleId === "user" && resourceId === "admin_panel") return "denied";
  if (roleId === "admin" && action === "manage") return "allowed";
  if (roleId === "owner" && resourceId.startsWith("org")) return "allowed";
  return "untested";
}

export function matrixSize(matrix: AuthorizationMatrix): number {
  return matrix.cells.length;
}

/** Load-test helper — O(roles × resources × actions) without pairwise permission compare. */
export function buildScaledAuthorizationMatrix(input: {
  roleCount: number;
  resourceCount: number;
}): AuthorizationMatrix {
  const cells: AuthorizationMatrixCell[] = [];
  for (let r = 0; r < input.roleCount; r++) {
    for (let res = 0; res < input.resourceCount; res++) {
      for (const action of BASE_ACTIONS) {
        cells.push({
          roleId: `role_${r}`,
          resourceId: `resource_${res}`,
          action,
          state: "untested",
        });
      }
    }
  }
  return { cells };
}

export function evaluateMatrixSample(
  matrix: AuthorizationMatrix,
  sampleSize: number
): { evaluations: number; uniqueKeys: number } {
  const keys = new Set<string>();
  let evaluations = 0;
  for (const cell of matrix.cells) {
    if (evaluations >= sampleSize) break;
    keys.add(`${cell.roleId}|${cell.resourceId}|${cell.action}`);
    evaluations++;
  }
  return { evaluations, uniqueKeys: keys.size };
}
