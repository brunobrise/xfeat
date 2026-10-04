const { buildChecks } = require("./lib/portfolio-checks");
const { renderLearn } = require("./lib/portfolio-learn");
const { longSentences } = require("./test_files/prose-lint");

const links = {
  evidence: (e) => `[\`${e.repo}:${e.file}:${e.line}\`](${e.file}#L${e.line})`,
};

function repo(slug, { test = false } = {}) {
  const evidence = { repo: slug, file: "Makefile", line: 2, hash: "h" };
  return {
    slug,
    status: { value: "active" },
    ownership: null,
    bins: [],
    commands: test
      ? [{ category: "test", cwd: ".", command: "make test", evidence }]
      : [],
  };
}

function model(repos, edges) {
  const graphEdges = edges.map(([from, to]) => ({
    id: `${from}->${to}:path-dependency:../${to}`,
    from,
    to,
    kind: "path-dependency",
    dependency: `../${to}`,
    confidence: "declared",
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
  ];
  return {
    repos,
    claims,
    graph: { edges: graphEdges },
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

  it("does not mention copied commands when no command is listed", () => {
    const text = render(model([repo("a"), repo("b")], [["a", "b"]]));
    expect(headings(text)).toContain("## 2. Run `a`");
    expect(text).not.toContain("It did not run them.");
  });

  it("explains missing facts instead of rendering empty steps", () => {
    const text = render(model([repo("solo")], []));
    expect(headings(text)).toEqual(["## 1. Orient", "## 2. Run `solo`"]);
    expect(text).toContain("No checks exist yet");
    expect(text).toContain("[gaps.md](gaps.md)");
  });
});
