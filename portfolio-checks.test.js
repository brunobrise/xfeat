const path = require("path");
const fs = require("fs/promises");
const { buildPortfolioModel } = require("./lib/portfolio-model");
const { loadPortfolioSelection } = require("./lib/portfolio-selection");
const {
  buildChecks,
  impactClosure,
  selectFocus,
} = require("./lib/portfolio-checks");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

describe("Portfolio checks", () => {
  const root = tempRoot("portfolio-checks");
  let model;
  let result;

  beforeAll(async () => {
    const dirs = await createPortfolioFixture(root);
    const manifest = path.join(root, "xfeat.portfolio.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "Acme Billing",
        repos: dirs.map((dir) =>
          path.basename(dir) === "sync-worker"
            ? { path: "sync-worker", owner: "@acme/data" }
            : { path: path.basename(dir) },
        ),
      }),
    );
    model = await buildPortfolioModel(
      await loadPortfolioSelection({ manifest }),
    );
    result = buildChecks(model);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const check = (id) => result.checks.find((item) => item.id === id);

  it("cites only claims that exist in the model, or the manifest", () => {
    const claimIds = new Set(model.claims.map((claim) => claim.id));
    expect(result.checks.length).toBeGreaterThan(0);
    for (const item of result.checks) {
      expect(item.claims.length > 0 || item.manifest === true).toBe(true);
      for (const id of item.claims) expect(claimIds.has(id)).toBe(true);
    }
  });

  it("asks who owns a repository, from cited or manifest-declared owners", () => {
    expect(check("owner:billing-api")).toMatchObject({
      step: "orient",
      kind: "owner",
      subject: "billing-api",
      question: "Who owns `billing-api`?",
      answer: { type: "set", values: ["group:payments"] },
      claims: ["billing-api:owner:default"],
    });
    expect(check("owner:sync-worker")).toMatchObject({
      answer: { type: "set", values: ["@acme/data"] },
      claims: [],
      manifest: true,
    });
    expect(check("owner:ledger")).toBeUndefined();
  });

  it("asks for declared test commands and accepts any of them", () => {
    expect(check("test-command:billing-api")).toMatchObject({
      step: "run",
      answer: { type: "one-of", values: ["make test"] },
      claims: ["billing-api:command:.:make test"],
    });
    expect(check("test-command:sync-worker")).toBeUndefined();
  });

  it("asks which repository provides a uniquely named program", () => {
    expect(check("binary:acme-sync")).toMatchObject({
      step: "orient",
      question: "Which repository provides the program `acme-sync`?",
      answer: { type: "value", values: ["sync-worker"] },
      claims: ["sync-worker:bin:acme-sync"],
    });
  });

  it("skips giveaway questions whose answer repeats the question", () => {
    expect(check("binary:ledger")).toBeUndefined();
  });

  it("builds dependency questions from declared edges only", () => {
    expect(check("dependencies:billing-api")).toMatchObject({
      step: "trace",
      answer: { type: "set", values: ["ledger"] },
    });
    expect(check("dependency-file:billing-api->ledger")).toMatchObject({
      question:
        "Which file in `billing-api` declares its dependency on `ledger`?",
      answer: { type: "one-of", values: ["go.mod"] },
      claims: [
        "edge:billing-api->ledger:go-module:github.com/acme/ledger:consumer",
      ],
    });
  });

  it("skips dependency questions that a name match or ambiguous name would make incomplete", () => {
    // billing-web also depends on ui-kit through a package-name match.
    expect(check("dependencies:billing-web")).toBeUndefined();
    // sync-worker uses acme-common, which ledger and platform-workflows share.
    expect(check("dependencies:sync-worker")).toBeUndefined();
    expect(check("dependency-file:sync-worker->ledger")).toBeUndefined();
    expect(check("impact:platform-workflows")).toBeUndefined();
  });

  it("skips provider questions whose module path names the repository", () => {
    expect(check("package-provider:github.com/acme/ledger")).toBeUndefined();
  });

  it("answers impact with the reverse closure over declared edges", () => {
    expect(check("impact:ledger")).toMatchObject({
      step: "impact",
      answer: { type: "set", values: ["billing-api", "sync-worker"] },
    });
    expect(check("impact:ledger").claims).toEqual([
      "edge:billing-api->ledger:go-module:github.com/acme/ledger:consumer",
      "edge:sync-worker->ledger:path-dependency:../ledger:consumer",
    ]);
    expect(check("impact:ui-kit")).toBeUndefined();
  });

  it("picks an active, connected, testable focus repository", () => {
    expect(selectFocus(model)).toBe("billing-api");
    expect(result.focus).toBe("billing-api");
  });

  it("produces stable, sorted output", () => {
    const ids = result.checks.map((item) => item.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(buildChecks(model))).toBe(JSON.stringify(result));
  });
});

describe("buildChecks on synthetic models", () => {
  const evidence = (repo, file, line = 1) => ({ repo, file, line, hash: "h" });
  function edge(from, to, dependency, extra = {}) {
    return {
      id: `${from}->${to}:go-module:${dependency}`,
      from,
      to,
      kind: "go-module",
      dependency,
      confidence: "declared",
      consumer: evidence(from, "go.mod", 3),
      provider: evidence(to, "go.mod", 1),
      ...extra,
    };
  }
  function model(edges, bins = []) {
    const slugs = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
    const repos = [...slugs, ...bins.map((b) => b.repo)].map((slug) => ({
      slug,
      status: { value: "active" },
      ownership: null,
      commands: [],
      bins: bins.filter((b) => b.repo === slug).map((b) => ({ name: b.name })),
    }));
    const claims = [
      ...edges.flatMap((e) => [
        { id: `edge:${e.id}:consumer` },
        { id: `edge:${e.id}:provider` },
      ]),
      ...bins.map((b) => ({ id: `${b.repo}:bin:${b.name}` })),
    ];
    return { repos, claims, graph: { edges, ambiguous: [] } };
  }
  const ids = (m) => buildChecks(m).checks.map((c) => c.id);

  it("asks which repository provides a module whose path does not name it", () => {
    expect(
      ids(model([edge("api", "ledger", "github.com/acme/money")])),
    ).toContain("package-provider:github.com/acme/money");
    expect(
      ids(model([edge("api", "ledger", "github.com/acme/ledger/v2")])),
    ).not.toContain("package-provider:github.com/acme/ledger/v2");
  });

  it("skips the declaring-file question when several files declare the dependency", () => {
    const repeated = edge("api", "ledger", "github.com/acme/money", {
      alsoDeclaredIn: ["tools/go.mod:4"],
    });
    expect(ids(model([repeated]))).not.toContain("dependency-file:api->ledger");
    expect(ids(model([repeated]))).toContain("dependencies:api");
  });

  it("ignores program names that are not strings instead of crashing", () => {
    const m = model(
      [edge("api", "ledger", "github.com/acme/money")],
      [
        { repo: "tools", name: 123 },
        { repo: "tools", name: "acme-cli" },
      ],
    );
    expect(ids(m)).toContain("binary:acme-cli");
  });
});

describe("selectFocus", () => {
  const repo = (slug, { test = false, status = "active" } = {}) => ({
    slug,
    status: { value: status },
    commands: test
      ? [{ category: "test", command: "make test", evidence: { line: 1 } }]
      : [],
  });
  const model = (repos, edges) => ({
    repos,
    graph: {
      edges: edges.map(([from, to]) => ({ from, to, confidence: "declared" })),
    },
  });

  it("prefers a testable repository over a connected one without tests", () => {
    const repos = [repo("a"), repo("b"), repo("c", { test: true })];
    expect(selectFocus(model(repos, [["a", "b"]]))).toBe("c");
  });

  it("prefers connected repositories among testable ones", () => {
    const repos = [repo("a", { test: true }), repo("b", { test: true })];
    expect(selectFocus(model(repos, [["b", "x"]]))).toBe("b");
  });

  it("falls back to inactive repositories when nothing else exists", () => {
    const repos = [repo("old", { status: "deprecated" })];
    expect(selectFocus(model(repos, []))).toBe("old");
  });
});

describe("impactClosure", () => {
  const edge = (from, to) => ({ from, to, consumer: { repo: from } });

  it("terminates on cycles and returns one shortest path per repository", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a")];
    const closure = impactClosure("c", edges);
    expect([...closure.keys()].sort()).toEqual(["a", "b"]);
    expect(closure.get("b").map((item) => item.from)).toEqual(["b"]);
    expect(closure.get("a").map((item) => item.from)).toEqual(["a", "b"]);
  });

  it("returns an empty map when nothing depends on the subject", () => {
    expect(impactClosure("a", [edge("a", "b")]).size).toBe(0);
  });
});
