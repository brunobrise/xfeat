const path = require("path");
const fs = require("fs/promises");
const { collectRepoFacts } = require("./lib/portfolio-repo-facts");
const { resolvePortfolioGraph } = require("./lib/portfolio-edges");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

describe("Portfolio cross-repository graph", () => {
  const root = tempRoot("portfolio-edges");
  let graph;

  beforeAll(async () => {
    const dirs = await createPortfolioFixture(root);
    const facts = [];
    for (const dir of dirs) {
      const name = path.basename(dir);
      facts.push(
        await collectRepoFacts({
          name,
          slug: name,
          path: await fs.realpath(dir),
          tags: [],
        }),
      );
    }
    graph = resolvePortfolioGraph(facts);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("resolves declared and name-match edges with evidence on both sides", () => {
    const summary = graph.edges.map((edge) => [
      edge.from,
      edge.to,
      edge.kind,
      edge.confidence,
      edge.dependency,
    ]);

    expect(summary).toEqual([
      [
        "billing-api",
        "ledger",
        "go-module",
        "declared",
        "github.com/acme/ledger",
      ],
      [
        "billing-web",
        "platform-workflows",
        "github-action",
        "declared",
        "acme/platform-workflows",
      ],
      ["billing-web", "ui-kit", "package-name", "name-match", "@acme/ui-kit"],
      ["sync-worker", "ledger", "path-dependency", "declared", "../ledger"],
    ]);
    const nameMatch = graph.edges.find((edge) => edge.kind === "package-name");
    expect(nameMatch.consumer).toMatchObject({
      repo: "billing-web",
      file: "package.json",
    });
    expect(nameMatch.provider).toMatchObject({
      repo: "ui-kit",
      file: "package.json",
      line: 2,
    });
    const goEdge = graph.edges.find((edge) => edge.kind === "go-module");
    expect(goEdge.provider).toMatchObject({
      repo: "ledger",
      file: "go.mod",
      line: 1,
    });
  });

  it("reports names provided by several repositories as ambiguous instead of guessing", () => {
    expect(graph.ambiguous).toEqual([
      expect.objectContaining({
        from: "sync-worker",
        dependency: "acme-common",
        ecosystem: "python",
        candidates: ["ledger", "platform-workflows"],
      }),
    ]);
    expect(graph.edges.some((edge) => edge.dependency === "acme-common")).toBe(
      false,
    );
  });

  it("indexes provided packages and flags shared names", () => {
    const uiKit = graph.packages.find((pkg) => pkg.name === "@acme/ui-kit");
    expect(uiKit).toMatchObject({ ecosystem: "npm", repos: ["ui-kit"] });
    const common = graph.packages.find(
      (pkg) => pkg.key === "python:acme-common",
    );
    expect(common.repos).toEqual(["ledger", "platform-workflows"]);
  });

  it("lists shared external dependencies with version drift", () => {
    const react = graph.sharedDependencies.find((dep) => dep.name === "react");
    expect(react).toMatchObject({ ecosystem: "npm", drift: true });
    expect(react.usages.map((u) => [u.repo, u.version])).toEqual([
      ["billing-web", "^18.2.0"],
      ["ui-kit", "^19.0.0"],
    ]);
  });

  it("detects protobuf packages declared in several repositories", () => {
    expect(graph.sharedContracts).toEqual([
      expect.objectContaining({
        kind: "protobuf",
        name: "billing.v1",
        repos: ["billing-api", "ledger"],
      }),
    ]);
  });

  it("resolves relative submodule URLs against the superproject remote or folder", () => {
    const repo = (slug, remoteUrl, submodules = []) => ({
      slug,
      path: `/work/${slug}`,
      git: { remoteUrl, prefix: "" },
      manifests: [],
      contracts: [],
      references: { actions: [], terraform: [], submodules },
    });
    const evidence = {
      repo: "legi-france",
      file: ".gitmodules",
      line: 3,
      hash: "x",
    };
    const remoteGraph = resolvePortfolioGraph([
      repo("legi-france", "https://github.com/brunobrise/legi-france", [
        { name: "legi", path: "vendor/legi", url: "../legi.py", evidence },
      ]),
      repo("legi-py", "https://github.com/brunobrise/legi.py"),
    ]);
    const localGraph = resolvePortfolioGraph([
      repo("site", "", [
        { name: "t", path: "theme", url: "../theme", evidence },
      ]),
      repo("theme", ""),
    ]);

    expect(remoteGraph.edges).toEqual([
      expect.objectContaining({
        from: "legi-france",
        to: "legi-py",
        kind: "git-submodule",
        confidence: "declared",
      }),
    ]);
    expect(localGraph.edges.map((edge) => [edge.from, edge.to])).toEqual([
      ["site", "theme"],
    ]);
  });

  function synthetic(slug, { manifests = [], remoteUrl = "" } = {}) {
    return {
      slug,
      path: `/work/${slug}`,
      git: { remoteUrl, prefix: "" },
      manifests: manifests.map((m) => ({
        dir: ".",
        role: "module",
        evidence: {
          repo: slug,
          file: `${m.dir || "."}/${m.file || "go.mod"}`,
          line: 1,
          hash: "h",
        },
        dependencies: [],
        ...m,
      })),
      contracts: [],
      references: { actions: [], terraform: [], submodules: [] },
    };
  }
  const ev = (repo) => ({ repo, file: "go.mod", line: 3, hash: "h" });

  it("matches the longest Go module path and reports duplicated module paths", () => {
    const graph = resolvePortfolioGraph([
      synthetic("api", {
        manifests: [
          {
            ecosystem: "go",
            name: "github.com/acme/api",
            dependencies: [
              {
                name: "github.com/acme/platform/auth/v2",
                kind: "runtime",
                line: 3,
                evidence: ev("api"),
              },
              {
                name: "github.com/acme/forked/lib",
                kind: "runtime",
                line: 4,
                evidence: ev("api"),
              },
            ],
          },
        ],
      }),
      synthetic("platform", {
        manifests: [{ ecosystem: "go", name: "github.com/acme/platform" }],
      }),
      synthetic("auth", {
        manifests: [
          { ecosystem: "go", name: "github.com/acme/platform/auth/v2" },
        ],
      }),
      synthetic("fork-a", {
        manifests: [{ ecosystem: "go", name: "github.com/acme/forked" }],
      }),
      synthetic("fork-b", {
        manifests: [{ ecosystem: "go", name: "github.com/acme/forked" }],
      }),
    ]);

    expect(graph.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["api", "auth", "go-module"],
    ]);
    expect(graph.ambiguous).toEqual([
      expect.objectContaining({
        from: "api",
        dependency: "github.com/acme/forked/lib",
        candidates: ["fork-a", "fork-b"],
      }),
    ]);
  });

  it("cites the provider manifest at the declared path and reports unresolved local paths", () => {
    const graph = resolvePortfolioGraph([
      synthetic("app", {
        manifests: [
          {
            ecosystem: "npm",
            name: "app",
            file: "package.json",
            dependencies: [
              {
                name: "@acme/ui",
                kind: "runtime",
                path: "../kit/packages/ui",
                line: 5,
                evidence: ev("app"),
              },
              {
                name: "@acme/gone",
                kind: "runtime",
                path: "../missing-repo",
                line: 6,
                evidence: ev("app"),
              },
            ],
          },
        ],
      }),
      synthetic("kit", {
        manifests: [
          {
            ecosystem: "npm",
            name: "@acme/kit",
            file: "package.json",
            dir: ".",
          },
          {
            ecosystem: "npm",
            name: "@acme/ui",
            file: "package.json",
            dir: "packages/ui",
          },
        ],
      }),
    ]);

    expect(graph.edges).toEqual([
      expect.objectContaining({
        from: "app",
        to: "kit",
        kind: "path-dependency",
        provider: expect.objectContaining({ file: "packages/ui/package.json" }),
      }),
    ]);
    expect(graph.unresolved).toEqual([
      expect.objectContaining({ from: "app", dependency: "../missing-repo" }),
    ]);
  });

  it("does not resolve remotes shared by several selected repositories", () => {
    const graph = resolvePortfolioGraph([
      {
        ...synthetic("site"),
        references: {
          actions: [{ ref: "acme/workflows", evidence: ev("site") }],
          terraform: [],
          submodules: [],
        },
      },
      synthetic("workflows", {
        remoteUrl: "https://github.com/acme/workflows",
      }),
      synthetic("workflows-copy", {
        remoteUrl: "https://github.com/acme/workflows",
      }),
    ]);

    expect(graph.edges).toEqual([]);
    expect(graph.ambiguous).toEqual([
      expect.objectContaining({
        from: "site",
        candidates: ["workflows", "workflows-copy"],
      }),
    ]);
  });
});
