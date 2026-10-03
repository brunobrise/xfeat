const path = require("path");
const fs = require("fs/promises");
const {
  discoverRepos,
  loadPortfolioSelection,
  writePortfolioManifest,
} = require("./lib/portfolio-selection");

describe("Portfolio repository selection", () => {
  const root = path.join(__dirname, "__portfolio_selection__");

  async function makeRepo(relative, { git = true } = {}) {
    const dir = path.join(root, relative);
    await fs.mkdir(dir, { recursive: true });
    if (git) await fs.mkdir(path.join(dir, ".git"), { recursive: true });
    return dir;
  }

  beforeEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await makeRepo("org/billing-api");
    await makeRepo("org/billing-web");
    await makeRepo("org/legacy-crm");
    await makeRepo("org/notes", { git: false });
    await makeRepo("other/billing-api");
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("discovers git repositories under a parent folder with include and exclude globs", async () => {
    const repos = await discoverRepos(path.join(root, "org"), {
      include: ["billing-*", "legacy-*"],
      exclude: ["legacy-*"],
    });

    expect(repos.map((repo) => path.basename(repo))).toEqual([
      "billing-api",
      "billing-web",
    ]);
  });

  it("loads a JSON manifest with paths relative to the manifest file", async () => {
    const manifestPath = path.join(root, "org", "xfeat.portfolio.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        name: "Billing Platform",
        description: "Services that invoice and collect payments.",
        output: "../portfolio-docs",
        repos: [
          {
            path: "billing-api",
            owner: "@acme/payments",
            system: "billing",
            lifecycle: "production",
            notes: "Owns the invoice state machine.",
            tags: ["service"],
          },
          { path: "./billing-web", name: "Billing Web" },
        ],
      }),
    );

    const selection = await loadPortfolioSelection({ manifest: manifestPath });

    expect(selection).toMatchObject({
      name: "Billing Platform",
      description: "Services that invoice and collect payments.",
      manifestPath,
      outDir: path.join(root, "portfolio-docs"),
    });
    expect(selection.repos).toEqual([
      expect.objectContaining({
        name: "billing-api",
        slug: "billing-api",
        path: path.join(root, "org", "billing-api"),
        owner: "@acme/payments",
        system: "billing",
        lifecycle: "production",
        notes: "Owns the invoice state machine.",
        tags: ["service"],
        manifestIndex: 0,
      }),
      expect.objectContaining({ name: "Billing Web", slug: "billing-web" }),
    ]);
  });

  it("disambiguates duplicate slugs and removes duplicate paths", async () => {
    const selection = await loadPortfolioSelection({
      paths: [
        path.join(root, "org", "billing-api"),
        path.join(root, "other", "billing-api"),
        path.join(root, "org", "billing-api", "."),
      ],
      cwd: root,
    });

    expect(selection.repos.map((repo) => repo.slug)).toEqual([
      "org-billing-api",
      "other-billing-api",
    ]);
    expect(selection.outDir).toBe(path.join(root, "xfeat-portfolio"));
  });

  it("accepts non-git folders passed explicitly", async () => {
    const selection = await loadPortfolioSelection({
      paths: [path.join(root, "org", "notes")],
      cwd: root,
    });

    expect(selection.repos).toHaveLength(1);
    expect(selection.repos[0].name).toBe("notes");
  });

  it("rejects missing paths, empty selections, and invalid manifests with actionable errors", async () => {
    await expect(
      loadPortfolioSelection({
        paths: [path.join(root, "missing")],
        cwd: root,
      }),
    ).rejects.toThrow(/Repository path not found: .*missing/);
    await expect(
      loadPortfolioSelection({ paths: [], cwd: root }),
    ).rejects.toThrow(/No repositories selected/);
    const badManifest = path.join(root, "bad.json");
    await fs.writeFile(badManifest, "{ not json");
    await expect(
      loadPortfolioSelection({ manifest: badManifest }),
    ).rejects.toThrow(/Invalid portfolio manifest .*bad\.json/);
    await fs.writeFile(badManifest, JSON.stringify({ repos: [{ name: "x" }] }));
    await expect(
      loadPortfolioSelection({ manifest: badManifest }),
    ).rejects.toThrow(/repos\[0\]\.path must be a string/);
    await fs.writeFile(
      badManifest,
      JSON.stringify({ repos: [{ path: "org/billing-api", owner: 7 }] }),
    );
    await expect(
      loadPortfolioSelection({ manifest: badManifest }),
    ).rejects.toThrow(/repos\[0\]\.owner must be a string/);
  });

  it("writes a reviewable manifest without overwriting an existing one", async () => {
    const manifestPath = path.join(root, "xfeat.portfolio.json");
    const repos = await discoverRepos(path.join(root, "org"));

    const first = await writePortfolioManifest(manifestPath, repos, {
      name: "Acme Platform",
    });
    const second = await writePortfolioManifest(manifestPath, [], {});
    const written = JSON.parse(await fs.readFile(manifestPath, "utf8"));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(written.name).toBe("Acme Platform");
    expect(written.repos).toEqual([
      { path: "org/billing-api" },
      { path: "org/billing-web" },
      { path: "org/legacy-crm" },
    ]);
  });
});
