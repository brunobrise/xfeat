const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { execFileSync } = require("child_process");
const {
  gitInfo,
  hermeticGitEnv,
  normalizeRemote,
  parseGitmodules,
  permalink,
} = require("./lib/portfolio-git");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");

function git(cwd, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=xfeat-test",
      "-c",
      "user.email=xfeat@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: hermeticGitEnv(),
    },
  ).trim();
}

// Simulates running inside a pre-commit hook of a linked worktree, where git
// exports variables that point every child git command at that repository.
// A `git init` that inherits them rewrites the shared config as bare.
async function withHookEnv(sentinel, run) {
  const saved = { ...process.env };
  process.env.GIT_DIR = path.join(sentinel, ".git", "worktrees", "wt");
  process.env.GIT_INDEX_FILE = path.join(sentinel, ".git", "index");
  try {
    return await run();
  } finally {
    for (const key of ["GIT_DIR", "GIT_INDEX_FILE"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

describe("Portfolio git metadata", () => {
  const root = tempRoot("portfolio-git");

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(root, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("normalizes ssh and https remotes to web URLs without credentials", () => {
    expect(normalizeRemote("git@github.com:acme/billing-api.git")).toBe(
      "https://github.com/acme/billing-api",
    );
    expect(normalizeRemote("ssh://git@gitlab.com/acme/group/api.git")).toBe(
      "https://gitlab.com/acme/group/api",
    );
    expect(
      normalizeRemote("https://deploy:s3cr3t-token@github.com/acme/web.git"),
    ).toBe("https://github.com/acme/web");
    expect(normalizeRemote("https://github.com/garrytan/gstack")).toBe(
      "https://github.com/garrytan/gstack",
    );
    expect(normalizeRemote("/srv/git/local.git")).toBe("");
    expect(normalizeRemote("")).toBe("");
  });

  it("builds host-specific permalinks pinned to a commit", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    expect(permalink("https://github.com/acme/api", sha, "src/a.js", 12)).toBe(
      `https://github.com/acme/api/blob/${sha}/src/a.js#L12`,
    );
    expect(permalink("https://gitlab.com/acme/api", sha, "src/a.js", 3)).toBe(
      `https://gitlab.com/acme/api/-/blob/${sha}/src/a.js#L3`,
    );
    expect(
      permalink("https://bitbucket.org/acme/api", sha, "src/a.js", 4),
    ).toBe(`https://bitbucket.org/acme/api/src/${sha}/src/a.js#lines-4`);
    expect(permalink("https://git.example.com/acme/api", sha, "a.js", 1)).toBe(
      "",
    );
    expect(permalink("", sha, "a.js", 1)).toBe("");
  });

  it("reads HEAD, branch, remote, tracked files, and dirty state", async () => {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, [
      "remote",
      "add",
      "origin",
      "git@github.com:acme/billing-api.git",
    ]);
    await fs.writeFile(path.join(root, "README.md"), "# Billing API\n");
    git(root, ["add", "README.md"]);
    git(root, ["commit", "-q", "-m", "init"]);

    const clean = gitInfo(root);
    await fs.writeFile(path.join(root, "notes.txt"), "draft\n");
    const dirty = gitInfo(root);

    expect(clean).toMatchObject({
      isRepo: true,
      branch: "main",
      remoteUrl: "https://github.com/acme/billing-api",
      dirty: false,
    });
    expect(clean.head).toMatch(/^[0-9a-f]{40}$/);
    expect(clean.lastCommitDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(clean.tracked.has("README.md")).toBe(true);
    expect(dirty.dirty).toBe(true);
  });

  it("reports non-git folders without throwing", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "xfeat-nogit-"));
    try {
      expect(gitInfo(outside)).toEqual(
        expect.objectContaining({ isRepo: false, head: "", remoteUrl: "" }),
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("scopes metadata to a selected subfolder of a larger repository", async () => {
    git(root, ["init", "-q", "-b", "main"]);
    git(root, ["remote", "add", "origin", "git@github.com:acme/mono.git"]);
    await fs.mkdir(path.join(root, "services", "ops"), { recursive: true });
    await fs.writeFile(
      path.join(root, "services", "ops", "main.go"),
      "package main\n",
    );
    await fs.writeFile(path.join(root, "README.md"), "# Mono\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-q", "-m", "init"]);
    await fs.writeFile(path.join(root, "README.md"), "# Mono changed\n");

    const info = gitInfo(path.join(root, "services", "ops"));

    expect(info).toMatchObject({
      isRepo: true,
      prefix: "services/ops",
      dirty: false,
    });
    expect([...info.tracked]).toEqual(["main.go"]);
  });

  async function hookRepository() {
    const sentinel = path.join(root, "hook-repo");
    await fs.mkdir(sentinel, { recursive: true });
    git(sentinel, ["init", "-q", "-b", "main"]);
    git(sentinel, ["commit", "-q", "--allow-empty", "-m", "init"]);
    git(sentinel, ["worktree", "add", "-q", path.join(root, "wt"), "-b", "wt"]);
    git(sentinel, ["config", "extensions.worktreeConfig", "true"]);
    return sentinel;
  }

  it("ignores repository variables inherited from a git hook", async () => {
    const sentinel = await hookRepository();
    const member = path.join(root, "member");
    for (const dir of [member]) {
      await fs.mkdir(dir, { recursive: true });
      git(dir, ["init", "-q", "-b", "main"]);
      await fs.writeFile(
        path.join(dir, "README.md"),
        `# ${path.basename(dir)}\n`,
      );
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-q", "-m", "init"]);
    }
    const memberHead = git(member, ["rev-parse", "HEAD"]);

    const info = await withHookEnv(sentinel, () => gitInfo(member));

    expect(info.head).toBe(memberHead);
    expect([...info.tracked]).toEqual(["README.md"]);
  });

  it("builds fixtures without touching a repository inherited from a git hook", async () => {
    const sentinel = await hookRepository();
    const configBefore = await fs.readFile(
      path.join(sentinel, ".git", "config"),
      "utf8",
    );

    await withHookEnv(sentinel, () =>
      createPortfolioFixture(path.join(root, "fixture")),
    );

    expect(
      await fs.readFile(path.join(sentinel, ".git", "config"), "utf8"),
    ).toBe(configBefore);
    expect(git(sentinel, ["ls-files", "--stage"])).toBe("");
    expect(git(sentinel, ["rev-parse", "--is-bare-repository"])).toBe("false");
  });

  it("parses .gitmodules entries with line evidence", () => {
    const modules = parseGitmodules(
      '[submodule "proto"]\n\tpath = vendor/proto\n\turl = git@github.com:acme/proto.git\n',
    );
    expect(modules).toEqual([
      {
        name: "proto",
        path: "vendor/proto",
        url: "git@github.com:acme/proto.git",
        line: 3,
      },
    ]);
  });

  it("normalizes scp-style ssh URLs that npm and Cargo accept", () => {
    expect(normalizeRemote("ssh://git@github.com:acme/ssh-lib.git")).toBe(
      "https://github.com/acme/ssh-lib",
    );
    expect(normalizeRemote("ssh://git@github.com:2222/acme/lib.git")).toBe(
      "https://github.com/acme/lib",
    );
  });
});
