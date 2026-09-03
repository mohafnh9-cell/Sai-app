import { describe, expect, it } from "vitest";
import { buildUploadSnapshot } from "../build-upload-snapshot";

describe("buildUploadSnapshot", () => {
  it("produces a RepositorySnapshot shape the scanner pipeline already understands", () => {
    const snapshot = buildUploadSnapshot({
      projectName: "demo-app",
      files: [{ path: "src/index.ts", content: "export {};", size: 10, sha: "" }],
      totalBytes: 10,
      omissions: [],
    });

    expect(snapshot.repo).toBe("demo-app");
    expect(snapshot.isPrivate).toBe(true);
    expect(snapshot.files).toHaveLength(1);
    expect(snapshot.commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is deterministic -- identical content produces the identical commitSha", () => {
    const files = [{ path: "a.ts", content: "x", size: 1, sha: "" }];
    const first = buildUploadSnapshot({ projectName: "p", files, totalBytes: 1, omissions: [] });
    const second = buildUploadSnapshot({ projectName: "p", files, totalBytes: 1, omissions: [] });
    expect(first.commitSha).toBe(second.commitSha);
  });

  it("produces a different commitSha for different content", () => {
    const a = buildUploadSnapshot({
      projectName: "p",
      files: [{ path: "a.ts", content: "x", size: 1, sha: "" }],
      totalBytes: 1,
      omissions: [],
    });
    const b = buildUploadSnapshot({
      projectName: "p",
      files: [{ path: "a.ts", content: "y", size: 1, sha: "" }],
      totalBytes: 1,
      omissions: [],
    });
    expect(a.commitSha).not.toBe(b.commitSha);
  });

  it("is order-independent -- file array order doesn't change the commitSha", () => {
    const fileA = { path: "a.ts", content: "1", size: 1, sha: "" };
    const fileB = { path: "b.ts", content: "2", size: 1, sha: "" };
    const first = buildUploadSnapshot({
      projectName: "p",
      files: [fileA, fileB],
      totalBytes: 2,
      omissions: [],
    });
    const second = buildUploadSnapshot({
      projectName: "p",
      files: [fileB, fileA],
      totalBytes: 2,
      omissions: [],
    });
    expect(first.commitSha).toBe(second.commitSha);
  });
});
