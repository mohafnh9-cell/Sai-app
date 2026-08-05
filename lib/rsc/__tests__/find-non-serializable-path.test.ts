import { describe, expect, it } from "vitest";
import { findNonSerializablePaths } from "@/lib/rsc/find-non-serializable-path";

describe("findNonSerializablePaths", () => {
  it("reports exact nested undefined path", () => {
    const issues = findNonSerializablePaths({
      fixPromptContext: {
        findings: [{ title: "x", description: undefined }],
      },
    });

    expect(issues).toContainEqual({
      path: "root.fixPromptContext.findings[0].description",
      kind: "undefined",
      valueType: "undefined",
    });
  });

  it("reports array index paths", () => {
    const issues = findNonSerializablePaths({
      items: [1, undefined, 3],
    });

    expect(issues[0]?.path).toBe("root.items[1]");
  });
});
