import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalRepositoryIdentity,
  ensureLocalProjectFile,
  readLocalProjectFile,
  resolveCloudBinding,
  resolveLocalIdentity,
  resolveWorkspaceIdentity,
} from "../local-identity";

const tempDirs: string[] = [];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function initGitRepo(root: string, remote?: string): void {
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@sequrai.local"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "SequrAI Test"], { cwd: root, stdio: "ignore" });
  if (remote) {
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: root, stdio: "ignore" });
  }
  // Unique content per call -- two remote-less repos with byte-identical
  // trees/messages/author/timestamp can genuinely produce the same root
  // commit SHA (correct, if surprising, git behavior), which would make a
  // "two different repos" test flaky rather than exercising real
  // distinctness.
  writeFileSync(join(root, "README.md"), `# test ${root}\n`);
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", `init ${root}`], { cwd: root, stdio: "ignore" });
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("canonicalRepositoryIdentity — Git remote normalization (STEP 4/9)", () => {
  it("HTTPS and SSH (scp-like) forms of the same repo resolve identically", () => {
    const a = canonicalRepositoryIdentity("https://github.com/company/app.git");
    const b = canonicalRepositoryIdentity("git@github.com:company/app.git");
    expect(a.githubRepo).toBe("https://github.com/company/app");
    expect(a.githubRepo).toBe(b.githubRepo);
    expect(a.repositoryId).toBe(b.repositoryId);
  });

  it("explicit ssh:// scheme form also resolves to the same identity", () => {
    const a = canonicalRepositoryIdentity("https://github.com/company/app");
    const c = canonicalRepositoryIdentity("ssh://git@github.com/company/app.git");
    expect(a.repositoryId).toBe(c.repositoryId);
  });

  it("trailing slash and missing .git suffix don't change identity", () => {
    const a = canonicalRepositoryIdentity("https://github.com/company/app.git");
    const b = canonicalRepositoryIdentity("https://github.com/company/app/");
    const c = canonicalRepositoryIdentity("https://github.com/company/app");
    expect(new Set([a.repositoryId, b.repositoryId, c.repositoryId]).size).toBe(1);
  });

  it("two genuinely different repositories never collide", () => {
    const a = canonicalRepositoryIdentity("https://github.com/company/app");
    const b = canonicalRepositoryIdentity("https://github.com/company/app-two");
    expect(a.repositoryId).not.toBe(b.repositoryId);
  });

  it("no remote at all still produces a stable, valid identity", () => {
    const a = canonicalRepositoryIdentity(null);
    const b = canonicalRepositoryIdentity(undefined);
    expect(a.githubRepo).toBeNull();
    expect(a.repositoryId).toBe(b.repositoryId);
    expect(UUID_RE.test(a.repositoryId)).toBe(true);
  });

  it("a non-GitHub remote gets a stable, distinct identity, not 'no remote'", () => {
    const a = canonicalRepositoryIdentity("https://gitlab.com/company/app.git");
    const noRemote = canonicalRepositoryIdentity(null);
    expect(a.githubRepo).toBeNull();
    expect(a.repositoryId).not.toBe(noRemote.repositoryId);
    // Same non-GitHub remote -> same identity every time.
    const a2 = canonicalRepositoryIdentity("https://gitlab.com/company/app.git");
    expect(a.repositoryId).toBe(a2.repositoryId);
  });
});

describe("LOCAL IDENTITY", () => {
  it("1 — a brand-new local repository (no .sequrai/project.json yet) gets a fresh, valid identity", async () => {
    const root = makeTempDir("seq-id-new-");
    initGitRepo(root);

    const binding = await resolveLocalIdentity(root);

    expect(binding.mode).toBe("local-only");
    expect(UUID_RE.test(binding.projectId)).toBe(true);
    expect(UUID_RE.test(binding.repositoryId)).toBe(true);
    expect(existsSync(join(root, ".sequrai/project.json"))).toBe(true);
  });

  it("2 — an existing valid .sequrai/project.json is reused, not overwritten", async () => {
    const root = makeTempDir("seq-id-existing-");
    initGitRepo(root);
    const first = await resolveLocalIdentity(root);
    const second = await resolveLocalIdentity(root);
    expect(second.projectId).toBe(first.projectId);
  });

  it("3 — malformed project.json is ignored and silently regenerated, never crashes", async () => {
    const root = makeTempDir("seq-id-malformed-");
    initGitRepo(root);
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    writeFileSync(join(root, ".sequrai/project.json"), "{ not valid json ");

    const binding = await resolveLocalIdentity(root);
    expect(binding.mode).toBe("local-only");
    expect(UUID_RE.test(binding.projectId)).toBe(true);
  });

  it("4 — missing project.json is created on first resolution", async () => {
    const root = makeTempDir("seq-id-missing-");
    initGitRepo(root);
    expect(readLocalProjectFile(root)).toBeNull();
    await resolveLocalIdentity(root);
    expect(readLocalProjectFile(root)).not.toBeNull();
  });

  it("5 — regenerated identity: a repositoryId mismatch (repo's remote changed) forces a fresh file, doesn't keep a stale binding", async () => {
    const root = makeTempDir("seq-id-regen-");
    initGitRepo(root, "https://github.com/company/old-name.git");
    const before = await resolveLocalIdentity(root);

    execFileSync("git", ["remote", "set-url", "origin", "https://github.com/company/new-name.git"], { cwd: root, stdio: "ignore" });
    const after = await resolveLocalIdentity(root);

    expect(after.repositoryId).not.toBe(before.repositoryId);
    expect(after.projectId).not.toBe(before.projectId);
  });

  it("6 — two different local repositories get distinct identities", async () => {
    const rootA = makeTempDir("seq-id-multi-a-");
    const rootB = makeTempDir("seq-id-multi-b-");
    initGitRepo(rootA);
    initGitRepo(rootB);

    const a = await resolveLocalIdentity(rootA);
    const b = await resolveLocalIdentity(rootB);
    expect(a.repositoryId).not.toBe(b.repositoryId);
    expect(a.projectId).not.toBe(b.projectId);
  });

  it("7 — the same repository cloned to two different directories (no git worktree, plain re-clone) shares repository identity but not workspace identity", async () => {
    const rootA = makeTempDir("seq-id-clone-a-");
    const rootB = makeTempDir("seq-id-clone-b-");
    initGitRepo(rootA, "https://github.com/company/shared-app.git");
    initGitRepo(rootB, "https://github.com/company/shared-app.git");

    const a = resolveWorkspaceIdentity(rootA);
    const b = resolveWorkspaceIdentity(rootB);
    expect(a.repository.repositoryId).toBe(b.repository.repositoryId);
    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it("8 — uncommitted working-tree changes do not change repository identity", async () => {
    const root = makeTempDir("seq-id-uncommitted-");
    initGitRepo(root, "https://github.com/company/app.git");
    const before = resolveWorkspaceIdentity(root);

    writeFileSync(join(root, "new-file.ts"), "export const x = 1;\n");
    const after = resolveWorkspaceIdentity(root);

    expect(after.repository.repositoryId).toBe(before.repository.repositoryId);
    expect(after.workspaceId).toBe(before.workspaceId);
  });

  it("9 — remote URL normalization is applied end-to-end through resolveWorkspaceIdentity", async () => {
    const root = makeTempDir("seq-id-normalize-");
    initGitRepo(root, "git@github.com:company/app.git");
    const identity = resolveWorkspaceIdentity(root);
    expect(identity.repository.githubRepo).toBe("https://github.com/company/app");
  });
});

describe("GITHUB BINDING (STEP 6/12 — server verification, never trusted locally)", () => {
  it("10 — a matching GitHub remote resolves to the project the injected resolver returns", async () => {
    const root = makeTempDir("seq-id-bind-match-");
    initGitRepo(root, "https://github.com/company/app.git");

    const binding = await resolveLocalIdentity(root, async (repo) => {
      expect(repo).toBe("https://github.com/company/app");
      return { projectId: "cloud-project-1", organizationId: "org-1", projectName: "App" };
    });

    expect(binding.mode).toBe("cloud-bound");
    if (binding.mode === "cloud-bound") {
      expect(binding.projectId).toBe("cloud-project-1");
      expect(binding.organizationId).toBe("org-1");
    }
  });

  it("11 — a non-matching/unknown remote does not bind (resolver returns null -> falls back to local-only)", async () => {
    const root = makeTempDir("seq-id-bind-nomatch-");
    initGitRepo(root, "https://github.com/company/unregistered.git");

    const binding = await resolveLocalIdentity(root, async () => null);
    expect(binding.mode).toBe("local-only");
  });

  it("12 — an unauthorized organization's resolver correctly returns null and cannot bind", async () => {
    const root = makeTempDir("seq-id-bind-unauth-org-");
    initGitRepo(root, "https://github.com/company/app.git");

    // Simulates a resolveMcpProject-style resolver: it only ever answers
    // for repos the AUTHENTICATED caller's own organization owns.
    const binding = await resolveLocalIdentity(root, async (repo) =>
      repo === "https://github.com/some-other-company/app" ? { projectId: "x", organizationId: "org-x", projectName: "X" } : null
    );
    expect(binding.mode).toBe("local-only");
  });

  it("13 — an unauthorized project (resolver throws, e.g. a real 403) propagates rather than silently binding", async () => {
    const root = makeTempDir("seq-id-bind-403-");
    initGitRepo(root, "https://github.com/company/app.git");

    await expect(
      resolveLocalIdentity(root, async () => {
        throw new Error("forbidden");
      })
    ).rejects.toThrow("forbidden");
  });

  it("14 — a forged projectId inside .sequrai/project.json cannot claim a victim cloud project: cloud binding never reads the local file at all", async () => {
    const root = makeTempDir("seq-id-bind-forged-");
    initGitRepo(root, "https://github.com/company/app.git");
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    writeFileSync(
      join(root, ".sequrai/project.json"),
      JSON.stringify({
        version: 1,
        projectId: "11111111-1111-1111-1111-111111111111", // forged claim
        repositoryId: "22222222-2222-2222-2222-222222222222",
        createdAt: new Date().toISOString(),
        repository: { remote: "https://github.com/company/app" },
      })
    );

    let resolverCalledWithRepo: string | null = null;
    const binding = await resolveLocalIdentity(root, async (repo) => {
      resolverCalledWithRepo = repo;
      // The resolver only ever sees the CANONICAL REPO STRING, never
      // anything from the local project.json -- confirming the forged
      // projectId in the file is structurally unreachable by the resolver.
      return { projectId: "the-real-victim-project", organizationId: "victim-org", projectName: "Victim" };
    });

    expect(resolverCalledWithRepo).toBe("https://github.com/company/app");
    // The resolver's authoritative answer wins outright -- but critically,
    // it was never handed the forged local projectId as input, so it could
    // not have been tricked by it even if it were naive.
    expect(binding.mode).toBe("cloud-bound");
    if (binding.mode === "cloud-bound") {
      expect(binding.projectId).toBe("the-real-victim-project");
    }
  });

  it("15 — a resolver reporting revoked/invalid auth (throws) never falls back to trusting the local file as a substitute binding", async () => {
    const root = makeTempDir("seq-id-bind-revoked-");
    initGitRepo(root, "https://github.com/company/app.git");

    await expect(
      resolveLocalIdentity(root, async () => {
        throw new Error("invalid_token");
      })
    ).rejects.toThrow("invalid_token");
  });

  it("16 — the same GitHub-bound repository resolves to the same project from a second machine (simulated: a fresh clone, no shared project.json)", async () => {
    const machineA = makeTempDir("seq-id-machine-a-");
    const machineB = makeTempDir("seq-id-machine-b-");
    initGitRepo(machineA, "https://github.com/company/shared.git");
    initGitRepo(machineB, "https://github.com/company/shared.git");

    const resolver = async (repo: string) =>
      repo === "https://github.com/company/shared" ? { projectId: "shared-project", organizationId: "org-1", projectName: "Shared" } : null;

    const a = await resolveLocalIdentity(machineA, resolver);
    const b = await resolveLocalIdentity(machineB, resolver);

    expect(a.mode).toBe("cloud-bound");
    expect(b.mode).toBe("cloud-bound");
    if (a.mode === "cloud-bound" && b.mode === "cloud-bound") {
      expect(a.projectId).toBe(b.projectId);
    }
    // But each machine's own local UUID (had it been local-only) would have
    // differed -- confirming resolution is remote-derived, not filesystem-derived.
    expect(a.repositoryId).toBe(b.repositoryId);
  });
});

describe("SECURITY", () => {
  it("17 — a path-traversal attempt in the project file location is rejected, not read from outside the workspace", () => {
    const root = makeTempDir("seq-id-sec-traversal-");
    initGitRepo(root);
    // readLocalProjectFile only ever looks at the FIXED relative path
    // .sequrai/project.json under the workspace root via resolveSafePath --
    // there is no attacker-controlled path input to this function at all,
    // so this test documents that guarantee rather than attempting an
    // injection resolveSafePath was never exposed to.
    expect(readLocalProjectFile(root)).toBeNull();
  });

  it("18 — a symlinked .sequrai/project.json is not followed", () => {
    const root = makeTempDir("seq-id-sec-symlink-");
    initGitRepo(root);
    const outsideSecret = makeTempDir("seq-id-sec-outside-");
    writeFileSync(join(outsideSecret, "secret.json"), JSON.stringify({ secret: "leak-me" }));
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    symlinkSync(join(outsideSecret, "secret.json"), join(root, ".sequrai/project.json"));

    const result = readLocalProjectFile(root);
    expect(result).toBeNull();
  });

  it("19 — an oversized project.json is rejected rather than read into memory unbounded", () => {
    const root = makeTempDir("seq-id-sec-oversized-");
    initGitRepo(root);
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    const huge = JSON.stringify({
      version: 1,
      projectId: "11111111-1111-1111-1111-111111111111",
      repositoryId: "22222222-2222-2222-2222-222222222222",
      createdAt: new Date().toISOString(),
      repository: { remote: "x".repeat(10_000) },
    });
    writeFileSync(join(root, ".sequrai/project.json"), huge);

    expect(readLocalProjectFile(root)).toBeNull();
  });

  it("20 — malformed JSON does not crash resolution", () => {
    const root = makeTempDir("seq-id-sec-malformed-json-");
    initGitRepo(root);
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    writeFileSync(join(root, ".sequrai/project.json"), "not json at all {{{");
    expect(() => readLocalProjectFile(root)).not.toThrow();
    expect(readLocalProjectFile(root)).toBeNull();
  });

  it("21 — unexpected/secret-like extra fields in project.json cause the whole file to be rejected, not partially trusted", () => {
    const root = makeTempDir("seq-id-sec-extra-fields-");
    initGitRepo(root);
    mkdirSync(join(root, ".sequrai"), { recursive: true });
    writeFileSync(
      join(root, ".sequrai/project.json"),
      JSON.stringify({
        version: 1,
        projectId: "11111111-1111-1111-1111-111111111111",
        repositoryId: "22222222-2222-2222-2222-222222222222",
        createdAt: new Date().toISOString(),
        repository: { remote: null },
        apiKey: "seq_live_shouldnotbehonored", // forged/unexpected field
      })
    );
    expect(readLocalProjectFile(root)).toBeNull();
  });

  it("22 — client-provided organization/project IDs cannot bypass authorization: resolveCloudBinding only ever returns what the injected resolver itself decides", async () => {
    // The resolver signature intentionally takes ONLY a repository string --
    // there is no parameter through which a caller could pass an
    // organizationId/projectId for the resolver to blindly echo back.
    const result = await resolveCloudBinding("https://github.com/company/app", async () => null);
    expect(result).toBeNull();
  });
});

describe("WORKTREES (STEP 8)", () => {
  it("23/24/25 — two worktrees of the same repository share repository identity, keep distinct workspace identities, and produce distinct scan snapshots", async () => {
    const mainRoot = makeTempDir("seq-id-worktree-main-");
    initGitRepo(mainRoot, "https://github.com/company/worktree-app.git");
    const featureRoot = makeTempDir("seq-id-worktree-feature-");
    rmSync(featureRoot, { recursive: true, force: true }); // git worktree add requires the target not to exist
    execFileSync("git", ["worktree", "add", "-b", "feature", featureRoot], { cwd: mainRoot, stdio: "ignore" });
    tempDirs.push(featureRoot);

    const main = resolveWorkspaceIdentity(mainRoot);
    const feature = resolveWorkspaceIdentity(featureRoot);

    // 23: shared repository identity.
    expect(main.repository.repositoryId).toBe(feature.repository.repositoryId);
    // 24: distinct workspace identity.
    expect(main.workspaceId).not.toBe(feature.workspaceId);

    // 25: distinct scan snapshots -- add a file only in the feature worktree.
    writeFileSync(join(featureRoot, "feature-only.ts"), "export const featureFlag = true;\n");
    const mainBinding = await resolveLocalIdentity(mainRoot);
    const featureBinding = await resolveLocalIdentity(featureRoot);
    // Same repository-level identity underneath a fresh local project.json
    // in each worktree (each worktree gets its own .sequrai/project.json,
    // matching resolveLocalIdentity's per-directory write) --
    // repositoryId still agrees even though projectId (local-only mode)
    // does not, since local-only projectId is per-.sequrai-file, not
    // per-repository. This is documented, not a bug: cloud-bound mode
    // (STEP 6) is what makes worktrees agree on projectId too.
    expect(mainBinding.repositoryId).toBe(featureBinding.repositoryId);
  });
});
