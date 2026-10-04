const { buildChecks } = require("./lib/portfolio-checks");
const { renderLearn } = require("./lib/portfolio-learn");
const { longSentences } = require("./test_files/prose-lint");

const links = {
  evidence: (e) => `[\`${e.repo}:${e.file}:${e.line}\`](${e.file}#L${e.line})`,
};

function repo(
  slug,
  { test = false, cwd = ".", remote = true, bins = [], owner = null } = {},
) {
  const evidence = { repo: slug, file: "Makefile", line: 2, hash: "h" };
  return {
    slug,
    status: { value: "active" },
    // A manifest-declared owner has no line evidence.
    ownership: owner
      ? { value: owner, label: "manifest", evidence: null }
      : null,
    bins: bins.map((name) => ({
      name,
      evidence: { repo: slug, file: "package.json", line: 3, hash: "h" },
    })),
    git: { remoteUrl: remote ? `git@github.com:acme/${slug}.git` : "" },
    commands: test
      ? [{ category: "test", cwd, command: "make test", evidence }]
      : [],
  };
}

// Edges are [from, to] pairs, or [from, to, "name-match"] for a package-name
// match that xfeat does not count as declared.
function model(repos, edges) {
  const graphEdges = edges.map(([from, to, confidence = "declared"]) => ({
    id: `${from}->${to}:path-dependency:../${to}`,
    from,
    to,
    kind: "path-dependency",
    dependency: `../${to}`,
    confidence,
    consumer: { repo: from, file: "deps.txt", line: 1, hash: "h" },
    provider: null,
  }));
  const claims = [
    ...repos.flatMap((item) =>
      item.commands.map((c) => ({
        id: `${item.slug}:command:${c.cwd}:${c.command}`,
        evidence: c.evidence,
      })),
    ),
    ...graphEdges.map((edge) => ({
      id: `edge:${edge.id}:consumer`,
      evidence: edge.consumer,
    })),
    ...repos.flatMap((item) =>
      item.bins.map((bin) => ({
        id: `${item.slug}:bin:${bin.name}`,
        evidence: bin.evidence,
      })),
    ),
  ];
  return {
    repos,
    claims,
    graph: { edges: graphEdges, ambiguous: [] },
    cloneOrder: repos.map((item) => ({ slug: item.slug, cycle: false })),
  };
}

const render = (m) => renderLearn(m, buildChecks(m), links);
const headings = (text) => text.match(/^## .+$/gm);

describe("renderLearn", () => {
  it("traces any declared edge when the focus repository has none", () => {
    const text = render(
      model([repo("a"), repo("b"), repo("c", { test: true })], [["a", "b"]]),
    );
    expect(headings(text)).toEqual([
      "## 1. Orient",
      "## 2. Run `c`",
      "## 3. Trace `a` to `b`",
      "## 4. Assess the impact of `b`",
      "## 5. Change `c`",
    ]);
    expect(text).toContain("In `c`, run `make test`.");
    expect(text).toContain("It did not run them.");
    expect(longSentences(text)).toEqual([]);
  });

  it("keeps the focus repository's own questions ahead of joins that repeat them", () => {
    const text = render(
      model(
        [
          repo("tools", {
            test: true,
            bins: ["acme-a", "acme-b", "acme-c"],
            owner: "@acme/tools",
          }),
        ],
        [],
      ),
    );
    const step = (name) =>
      text.split(/^## /m).find((section) => section.includes(name));
    const run = step("Run `tools`");
    expect(run).toContain("Which declared command runs the tests of `tools`?");
    expect(run).not.toContain("the repository that provides the program");
    const orient = step("Orient");
    expect(orient).toContain("Who owns `tools`?");
    expect(orient).not.toContain("Who owns the repository that provides");
  });

  it("cites the portfolio manifest when a join relies on it", () => {
    const m = model(
      [repo("tools", { bins: ["acme-a"], owner: "@acme/tools" })],
      [],
    );
    const join = buildChecks(m).checks.find(
      (c) => c.id === "program-owner:acme-a",
    );
    // Render only the join to see its answer text.
    const text = renderLearn(m, { focus: "tools", checks: [join] }, links);
    expect(text).toMatch(
      /Source: \[`tools:package.json:3`\][^\n]*the portfolio manifest\./,
    );
  });

  it("asks the multi-hop dependency question in the trace step", () => {
    const text = render(
      model(
        [repo("web", { test: true }), repo("api"), repo("ledger")],
        [
          ["web", "api"],
          ["api", "ledger"],
        ],
      ),
    );
    const trace = text.split(/^## /m).find((s) => s.startsWith("3. Trace"));
    expect(trace).toContain(
      "Which selected repositories does `web` depend on, directly or through others?",
    );
  });

  it("does not mention copied commands when no command is listed", () => {
    const text = render(model([repo("a"), repo("b")], [["a", "b"]]));
    expect(headings(text)).toContain("## 2. Run `a`");
    expect(text).not.toContain("It did not run them.");
  });

  it("explains missing facts without claiming they do not exist", () => {
    const text = render(model([repo("solo")], []));
    expect(headings(text)).toEqual(["## 1. Orient", "## 2. Run `solo`"]);
    expect(text).toContain(
      "No checks could be generated from declared, cited facts.",
    );
    expect(text).toContain("[gaps.md](gaps.md)");
    expect(text).toContain("Each answer cites the source it comes from.");
  });

  it("runs the test command in the folder that declares it", () => {
    const text = render(
      model([repo("lib", { test: true, cwd: "packages/core" })], []),
    );
    expect(text).toContain("In `lib/packages/core`, run `make test`.");
    expect(text).toContain("Run `make test` in `lib/packages/core`.");
  });

  it("lists dependents found by package-name match before saying there are none", () => {
    const text = render(
      model(
        [repo("app"), repo("lib", { test: true })],
        [["app", "lib", "name-match"]],
      ),
    );
    expect(text).toContain("`app`");
    expect(text).not.toContain("No selected repository declares a dependency");
  });

  it("does not tell readers to clone a repository without a remote", () => {
    const text = render(
      model(
        // Synthetic clone order follows this list: providers first.
        [repo("lib", { remote: false }), repo("api", { test: true })],
        [["api", "lib"]],
      ),
    );
    expect(text).toContain("Get `lib` from its owner. It has no git remote.");
    expect(text).toContain("1. Get `lib`");
    expect(text).toContain("2. Clone `api`.");
  });

  it("only promises a provider line when the edge has provider evidence", () => {
    const text = render(
      model([repo("a", { test: true }), repo("b")], [["a", "b"]]),
    );
    expect(text).not.toContain("to the provider line");
    expect(text).toContain("from the line that declares it");
  });

  it("keeps sentences short on large portfolios", () => {
    const names = Array.from({ length: 30 }, (_, i) => `app-${i}`);
    const text = render(
      model(
        [repo("core", { test: true }), ...names.map((name) => repo(name))],
        names.map((name) => [name, "core"]),
      ),
    );
    expect(longSentences(text)).toEqual([]);
    expect(text).toContain("and 20 more in `checks.json`");
  });
});
