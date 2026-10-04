const path = require("path");
const fs = require("fs/promises");
const { scanPortfolio } = require("./lib/portfolio-docs");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");

async function readOut(outDir, file) {
  return fs.readFile(path.join(outDir, file), "utf8");
}

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

describe("xfeat portfolio output safety", () => {
  const root = tempRoot("portfolio-safety");
  const outDir = path.join(root, "portfolio-out");
  let repos;

  beforeEach(async () => {
    repos = await createPortfolioFixture(path.join(root, "repos"));
    await fs.rm(outDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("refuses an output folder inside a selected repository without creating it", async () => {
    await expect(
      scanPortfolio({
        paths: repos,
        out: path.join(repos[0], "docs", "portfolio"),
        cwd: root,
      }),
    ).rejects.toThrow(/inside selected repository billing-web/);
    await expect(fs.stat(path.join(repos[0], "docs"))).rejects.toThrow();

    const linkedOut = path.join(root, "linked-out");
    await fs.mkdir(path.join(repos[1], "generated"), { recursive: true });
    await fs.symlink(path.join(repos[1], "generated"), linkedOut);
    await expect(
      scanPortfolio({ paths: repos, out: linkedOut, cwd: root }),
    ).rejects.toThrow(/inside selected repository ui-kit/);
    expect(await fs.readdir(path.join(repos[1], "generated"))).toEqual([]);
  });

  it("refuses to overwrite a generated path that is a symlink to another file", async () => {
    const victim = path.join(root, "victim.md");
    await fs.writeFile(victim, "# Keep me\n");
    await fs.mkdir(outDir, { recursive: true });
    await fs.symlink(victim, path.join(outDir, "index.md"));

    await expect(
      scanPortfolio({ paths: repos, out: outDir, cwd: root }),
    ).rejects.toThrow(/outside the output folder/);
    expect(await fs.readFile(victim, "utf8")).toBe("# Keep me\n");
  });

  it("removes pages it generated earlier when a repository leaves the selection", async () => {
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    await fs.writeFile(path.join(outDir, "handwritten.md"), "# Notes\n");
    const result = await scanPortfolio({
      paths: repos.filter((repo) => !repo.endsWith("sync-worker")),
      out: outDir,
      cwd: root,
    });

    expect(result.removed).toContain("repos/sync-worker.md");
    const withoutLedger = await scanPortfolio({
      paths: repos.filter((repo) => !repo.endsWith("ledger")),
      out: outDir,
      cwd: root,
    });
    expect(withoutLedger.gaps).toBeGreaterThan(0);
    expect(await readOut(outDir, "gaps.md")).toMatch(
      /sync-worker.*unresolved-dependency.*\.\.\/ledger/,
    );
    await expect(
      fs.stat(path.join(outDir, "handwritten.md")),
    ).resolves.toBeTruthy();
  });

  it("never deletes files it did not generate, even when an old model lists them", async () => {
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    const statusPath = path.join(outDir, "portfolio.json");
    const status = JSON.parse(await fs.readFile(statusPath, "utf8"));
    const outside = path.join(root, "outside.md");
    const linked = path.join(root, "linked-target");
    await fs.writeFile(outside, "---\ngenerator: xfeat portfolio\n---\n");
    await fs.mkdir(linked, { recursive: true });
    await fs.writeFile(
      path.join(linked, "page.md"),
      "---\ngenerator: xfeat portfolio\n---\n",
    );
    await fs.symlink(linked, path.join(outDir, "linked"));
    await fs.writeFile(path.join(outDir, "handwritten.md"), "# Notes\n");
    status.documents.push(
      "handwritten.md",
      "../outside.md",
      "linked/page.md",
      outside,
    );
    await fs.writeFile(statusPath, JSON.stringify(status));

    const result = await scanPortfolio({
      paths: repos,
      out: outDir,
      cwd: root,
    });

    expect(result.removed).toEqual([]);
    await expect(
      fs.stat(path.join(outDir, "handwritten.md")),
    ).resolves.toBeTruthy();
    await expect(fs.stat(outside)).resolves.toBeTruthy();
    await expect(fs.stat(path.join(linked, "page.md"))).resolves.toBeTruthy();
  });

  it("refuses to write generated pages through a symlinked output subfolder", async () => {
    const elsewhere = path.join(root, "elsewhere");
    await fs.mkdir(elsewhere, { recursive: true });
    await fs.mkdir(outDir, { recursive: true });
    await fs.symlink(elsewhere, path.join(outDir, "repos"));

    await expect(
      scanPortfolio({ paths: repos, out: outDir, cwd: root }),
    ).rejects.toThrow(/outside the output folder/);
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });
});
