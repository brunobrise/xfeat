const { byText } = require("./portfolio-util");

// Checks are questions whose answers come from declared, cited facts. They
// serve two readers: an engineer testing their own understanding, and an
// evaluation that grades a coding agent's answers. Package-name matches and
// ambiguous names are never used as answers, because they are not verified.
// When one of them touches a question, the question is skipped instead,
// because its declared-only answer would be incomplete.

const INACTIVE = new Set(["deprecated", "dormant"]);
const PATH_LIKE = /^(\.{1,2}\/|\/)/;

const FORMATS = {
  owner: "list of owners",
  binary: "repository name",
  "test-command": "command",
  dependencies: "list of repository names",
  "dependency-file": "file path relative to the repository root",
  "package-provider": "repository name",
  impact: "list of repository names",
};

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

// The focus repository anchors the run and change steps. Prefer repositories
// that are not deprecated or dormant, then a declared test command, because
// a small real change with a test run is the step newcomers learn most from,
// then the most declared edges, then name order.
function selectFocus(model) {
  const edges = declaredEdges(model);
  const degree = (slug) =>
    edges.filter((edge) => edge.from === slug || edge.to === slug).length;
  const active = model.repos.filter((repo) => !INACTIVE.has(repo.status.value));
  const pool = active.length ? active : model.repos;
  const ranked = [...pool].sort(
    (a, b) =>
      Number(testCommands(b).length > 0) - Number(testCommands(a).length > 0) ||
      degree(b.slug) - degree(a.slug) ||
      byText(a.slug, b.slug),
  );
  return ranked[0]?.slug || "";
}

function makeCheck(kind, step, key, subject, question, answer, refs) {
  const claims = [...new Set(refs.claims || [])].sort(byText);
  return {
    id: `${kind}:${key}`,
    step,
    kind,
    subject,
    question,
    format: FORMATS[kind],
    answer: { type: answer.type, values: [...answer.values] },
    claims,
    ...(refs.manifest ? { manifest: true } : {}),
  };
}

function ownerChecks(repo, claims) {
  const owner = repo.ownership;
  if (!owner?.value) return [];
  const claimId = `${repo.slug}:owner:default`;
  const cited = owner.evidence && claims.has(claimId);
  const fromManifest = owner.label === "manifest";
  if (!cited && !fromManifest) return [];
  const values = owner.value
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .sort(byText);
  return [
    makeCheck(
      "owner",
      "orient",
      repo.slug,
      repo.slug,
      `Who owns \`${repo.slug}\`?`,
      { type: "set", values },
      cited ? { claims: [claimId] } : { manifest: true },
    ),
  ];
}

function testCommandChecks(repo, claims) {
  const commands = testCommands(repo).filter((command) =>
    claims.has(`${repo.slug}:command:${command.cwd}:${command.command}`),
  );
  if (!commands.length) return [];
  return [
    makeCheck(
      "test-command",
      "run",
      repo.slug,
      repo.slug,
      `Which declared command runs the tests of \`${repo.slug}\`?`,
      {
        type: "one-of",
        values: [...new Set(commands.map((c) => c.command))].sort(byText),
      },
      {
        claims: commands.map(
          (c) => `${repo.slug}:command:${c.cwd}:${c.command}`,
        ),
      },
    ),
  ];
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

function binaryChecks(model, claims) {
  const providers = new Map();
  for (const repo of model.repos) {
    for (const bin of repo.bins) {
      if (typeof bin.name !== "string" || !bin.name) continue;
      if (!claims.has(`${repo.slug}:bin:${bin.name}`)) continue;
      if (!providers.has(bin.name)) providers.set(bin.name, new Set());
      providers.get(bin.name).add(repo.slug);
    }
  }
  return [...providers.entries()]
    .filter(
      ([name, repos]) => repos.size === 1 && !giveaway(name, [...repos][0]),
    )
    .map(([name, repos]) => {
      const slug = [...repos][0];
      return makeCheck(
        "binary",
        "orient",
        name,
        slug,
        `Which repository provides the program \`${name}\`?`,
        { type: "value", values: [slug] },
        { claims: [`${slug}:bin:${name}`] },
      );
    });
}

function dependencyChecks(model, edges, claims, all) {
  const checks = [];
  const cited = (edge, side) =>
    claims.has(edgeClaim(edge, side)) ? [edgeClaim(edge, side)] : [];
  for (const repo of model.repos) {
    const outgoing = edges.filter(
      (edge) => edge.from === repo.slug && cited(edge, "consumer").length,
    );
    if (!outgoing.length) continue;
    const seen = all.filter((edge) => edge.from === repo.slug);
    // Every dependency xfeat saw must be declared and cited; otherwise the
    // declared-only answer is incomplete and a correct reader is marked wrong.
    if (seen.length !== outgoing.length) continue;
    checks.push(
      makeCheck(
        "dependencies",
        "trace",
        repo.slug,
        repo.slug,
        `Which selected repositories does \`${repo.slug}\` depend on?`,
        {
          type: "set",
          values: [...new Set(outgoing.map((e) => e.to))].sort(byText),
        },
        { claims: outgoing.flatMap((edge) => cited(edge, "consumer")) },
      ),
    );
    const targets = [...new Set(outgoing.map((edge) => edge.to))];
    for (const target of targets) {
      const pair = outgoing.filter((edge) => edge.to === target);
      // A dependency declared in several files keeps only its first location
      // as evidence, so "which file" would have uncited correct answers.
      if (pair.some((edge) => (edge.alsoDeclaredIn || []).length)) continue;
      checks.push(
        makeCheck(
          "dependency-file",
          "trace",
          `${repo.slug}->${target}`,
          repo.slug,
          `Which file in \`${repo.slug}\` declares its dependency on \`${target}\`?`,
          {
            type: "one-of",
            values: [...new Set(pair.map((e) => e.consumer.file))].sort(byText),
          },
          { claims: pair.flatMap((edge) => cited(edge, "consumer")) },
        ),
      );
    }
  }
  const providers = new Map();
  for (const edge of edges) {
    if (PATH_LIKE.test(edge.dependency) || !cited(edge, "provider").length) {
      continue;
    }
    if (!providers.has(edge.dependency)) providers.set(edge.dependency, []);
    providers.get(edge.dependency).push(edge);
  }
  for (const [dependency, list] of providers) {
    const targets = [...new Set(list.map((edge) => edge.to))];
    if (targets.length !== 1 || giveaway(dependency, targets[0])) continue;
    const others = all.filter(
      (edge) => edge.dependency === dependency && edge.to !== targets[0],
    );
    if (others.length) continue;
    checks.push(
      makeCheck(
        "package-provider",
        "trace",
        dependency,
        targets[0],
        `Which repository provides \`${dependency}\`?`,
        { type: "value", values: targets },
        { claims: list.flatMap((edge) => cited(edge, "provider")) },
      ),
    );
  }
  return checks;
}

function impactChecks(model, edges, claims, all) {
  const usable = edges.filter((edge) =>
    claims.has(edgeClaim(edge, "consumer")),
  );
  const checks = [];
  for (const repo of model.repos) {
    const closure = impactClosure(repo.slug, usable);
    if (!closure.size) continue;
    // Skip when a package-name match, an ambiguous name, or an uncited edge
    // reaches more repositories than the declared, cited edges do.
    const reach = impactClosure(repo.slug, all);
    if (!sameSet([...reach.keys()], [...closure.keys()])) continue;
    const used = new Set();
    for (const chain of closure.values()) {
      for (const edge of chain) used.add(edgeClaim(edge, "consumer"));
    }
    checks.push(
      makeCheck(
        "impact",
        "impact",
        repo.slug,
        repo.slug,
        `Which selected repositories can a change in \`${repo.slug}\` affect through declared dependencies?`,
        { type: "set", values: [...closure.keys()].sort(byText) },
        { claims: [...used] },
      ),
    );
  }
  return checks;
}

// Builds every check for the model, sorted by id so output is byte-stable.
function buildChecks(model) {
  const claims = claimIndex(model);
  const edges = declaredEdges(model);
  const all = allDependencyEdges(model);
  const checks = [
    ...model.repos.flatMap((repo) => ownerChecks(repo, claims)),
    ...binaryChecks(model, claims),
    ...model.repos.flatMap((repo) => testCommandChecks(repo, claims)),
    ...dependencyChecks(model, edges, claims, all),
    ...impactChecks(model, edges, claims, all),
  ].sort((a, b) => byText(a.id, b.id));
  return { focus: selectFocus(model), checks };
}

function serializeChecks(plan, generator) {
  return `${JSON.stringify(
    { schemaVersion: 1, generator, focus: plan.focus, checks: plan.checks },
    null,
    2,
  )}\n`;
}

// Maps each claim id to the checks that cite it, so a verify finding can say
// which questions became stale.
function checksByClaim(checks) {
  const index = new Map();
  for (const check of checks) {
    for (const claim of check.claims || []) {
      if (!index.has(claim)) index.set(claim, []);
      index.get(claim).push(check.id);
    }
  }
  return index;
}

function unknownClaimFindings(checks, claimIds) {
  const findings = [];
  for (const check of checks) {
    for (const claim of check.claims || []) {
      if (!claimIds.has(claim)) {
        findings.push({ type: "check-claim-missing", check: check.id, claim });
      }
    }
  }
  return findings;
}

module.exports = {
  allDependencyEdges,
  buildChecks,
  checksByClaim,
  serializeChecks,
  unknownClaimFindings,
  declaredEdges,
  impactClosure,
  selectFocus,
  testCommands,
};
