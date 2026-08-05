export type NonSerializableIssue = {
  path: string;
  kind: "undefined" | "function" | "symbol" | "bigint" | "circular";
  valueType: string;
};

/**
 * Walk a value tree and return exact paths that break RSC/JSON serialization.
 * Diagnostic only — does not mutate input.
 */
export function findNonSerializablePaths(
  value: unknown,
  options?: { rootLabel?: string; maxIssues?: number }
): NonSerializableIssue[] {
  const rootLabel = options?.rootLabel ?? "root";
  const maxIssues = options?.maxIssues ?? 20;
  const issues: NonSerializableIssue[] = [];
  const seen = new WeakSet<object>();

  function walk(current: unknown, path: string): void {
    if (issues.length >= maxIssues) return;

    if (current === undefined) {
      issues.push({ path, kind: "undefined", valueType: "undefined" });
      return;
    }

    if (typeof current === "function") {
      issues.push({ path, kind: "function", valueType: "function" });
      return;
    }

    if (typeof current === "symbol") {
      issues.push({ path, kind: "symbol", valueType: "symbol" });
      return;
    }

    if (typeof current === "bigint") {
      issues.push({ path, kind: "bigint", valueType: "bigint" });
      return;
    }

    if (current === null || typeof current !== "object") {
      return;
    }

    if (seen.has(current)) {
      issues.push({ path, kind: "circular", valueType: "object" });
      return;
    }
    seen.add(current);

    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    if (current instanceof Date) {
      return;
    }

    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      walk(nested, `${path}.${key}`);
    }
  }

  walk(value, rootLabel);
  return issues;
}

/** Returns first failing path or null if JSON.stringify succeeds. */
export function firstJsonSerializeFailure(value: unknown, rootLabel = "root"): string | null {
  try {
    JSON.stringify(value);
    return null;
  } catch (error) {
    const issues = findNonSerializablePaths(value, { rootLabel, maxIssues: 1 });
    if (issues[0]) {
      return `${issues[0].path} (${issues[0].kind})`;
    }
    return error instanceof Error ? error.message : String(error);
  }
}
