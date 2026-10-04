const { byText } = require("./portfolio-util");

// Shared building blocks for portfolio checks: the check record, edge
// selection, and the graph walks behind impact and dependency closures.

const FORMATS = {
  owner: "list of owners",
  binary: "repository name",
  "program-owner": "list of owners",
  "test-command": "command",
  "program-test-command": "command",
  dependencies: "list of repository names",
  "transitive-dependencies": "list of repository names",
  "dependency-file": "file path relative to the repository root",
  "package-provider": "repository name",
  impact: "list of repository names",
};

// `hops` counts the facts a reader must connect: 1 for a lookup, 2 for a
// join, the longest chain for a closure. Graders report accuracy per hop count.
function makeCheck(kind, step, key, subject, question, answer, refs, hops = 1) {
  const claims = [...new Set(refs.claims || [])].sort(byText);
  return {
    id: `${kind}:${key}`,
    step,
    kind,
    subject,
    question,
    format: FORMATS[kind],
    hops,
    answer: { type: answer.type, values: [...answer.values] },
    claims,
    ...(refs.manifest ? { manifest: true } : {}),
  };
}

function declaredEdges(model) {
  return model.graph.edges.filter((edge) => edge.confidence === "declared");
}

// Every dependency xfeat saw, whatever its confidence. Ambiguous names become
// one possible edge per candidate, because any of them may be the provider.
function allDependencyEdges(model) {
  const possible = (model.graph.ambiguous || []).flatMap((item) =>
    item.candidates
      .filter((candidate) => candidate !== item.from)
      .map((candidate) => ({
        id: `ambiguous:${item.from}->${candidate}:${item.dependency}`,
        from: item.from,
        to: candidate,
        dependency: item.dependency,
        confidence: "ambiguous",
        consumer: item.consumer,
      })),
  );
  return [...model.graph.edges, ...possible];
}

function sameSet(a, b) {
  const left = [...new Set(a)].sort(byText);
  const right = [...new Set(b)].sort(byText);
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  );
}

function claimIndex(model) {
  return new Set(model.claims.map((claim) => claim.id));
}

function edgeClaim(edge, side) {
  return `edge:${edge.id}:${side}`;
}

function testCommands(repo) {
  return repo.commands.filter(
    (command) => command.category === "test" && command.evidence,
  );
}

// A question that names its answer cannot tell a reader who knows the code
// from one who does not: a program called like its repository, or a module
// path ending in the repository name (`github.com/acme/ledger`, `/v2` aside).
function giveaway(name, slug) {
  const last = String(name)
    .toLowerCase()
    .replace(/\/v\d+$/, "")
    .split("/")
    .pop();
  return last === slug.toLowerCase();
}

// Breadth-first search over reverse edges. Returns, for every repository that
// can be affected by a change in `subject`, the shortest chain of edges from
// that repository to the subject. Cycles terminate because each repository is
// visited once.
function impactClosure(subject, edges) {
  const dependents = new Map();
  for (const edge of edges) {
    if (!dependents.has(edge.to)) dependents.set(edge.to, []);
    dependents.get(edge.to).push(edge);
  }
  const paths = new Map();
  const queue = [{ slug: subject, path: [] }];
  const seen = new Set([subject]);
  while (queue.length) {
    const { slug, path } = queue.shift();
    const incoming = [...(dependents.get(slug) || [])].sort(
      (a, b) => byText(a.from, b.from) || byText(a.id || "", b.id || ""),
    );
    for (const edge of incoming) {
      if (seen.has(edge.from)) continue;
      seen.add(edge.from);
      const next = [edge, ...path];
      paths.set(edge.from, next);
      queue.push({ slug: edge.from, path: next });
    }
  }
  return paths;
}

// Same walk, following edges from consumer to provider: for every repository
// `subject` depends on, directly or not, the shortest chain.
function dependencyClosure(subject, edges) {
  const reversed = edges.map((edge) => ({
    ...edge,
    from: edge.to,
    to: edge.from,
  }));
  return impactClosure(subject, reversed);
}

module.exports = {
  FORMATS,
  allDependencyEdges,
  claimIndex,
  declaredEdges,
  dependencyClosure,
  edgeClaim,
  giveaway,
  impactClosure,
  makeCheck,
  sameSet,
  testCommands,
};
