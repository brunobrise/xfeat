const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { execFileSync } = require("child_process");
const {
  gitInfo,
  normalizeRemote,
  parseGitmodules,
  permalink,
} = require("./lib/portfolio-git");

function git(cwd, args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=xfeat-test",
      "-c",
      "user.email=xfeat@example.com",
      ...args,
    ],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
}

describe("Portfolio git metadata", () => {
  const root = path.join(__dirname, "__portfolio_git__");

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
});
