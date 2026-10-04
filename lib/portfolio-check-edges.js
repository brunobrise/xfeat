const { byText } = require("./portfolio-util");
const {
  dependencyClosure,
  edgeClaim,
  giveaway,
  impactClosure,
  makeCheck,
  sameSet,
} = require("./portfolio-check-base");

// Checks about declared cross-repository edges: direct dependencies, the file
// that declares each one, module providers, and the impact and dependency
// closures. A question is skipped when a package-name match, an ambiguous
// name, or an uncited edge would make its declared-only answer incomplete.

const PATH_LIKE = /^(\.{1,2}\/|\/)/;

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
  return [...checks, ...providerChecks(edges, all, cited)];
}

function providerChecks(edges, all, cited) {
  const providers = new Map();
  for (const edge of edges) {
    if (PATH_LIKE.test(edge.dependency) || !cited(edge, "provider").length) {
      continue;
    }
    if (!providers.has(edge.dependency)) providers.set(edge.dependency, []);
    providers.get(edge.dependency).push(edge);
  }
  const checks = [];
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

// Closure answers cite every edge on every chain, and are skipped when a
// package-name match, an ambiguous name, or an uncited edge reaches more
// repositories than the declared, cited edges do.
function closureFacts(closure, reach) {
  if (!closure.size || !sameSet([...reach.keys()], [...closure.keys()])) {
    return null;
  }
  const used = new Set();
  for (const chain of closure.values()) {
    for (const edge of chain) used.add(edgeClaim(edge, "consumer"));
  }
  // Hops follow every dependency xfeat saw: a package-name shortcut makes a
  // repository one hop away even when the cited path takes two. Each chain is
  // the shortest one, so hops is the longest shortest chain.
  let hops = 0;
  for (const chain of reach.values()) hops = Math.max(hops, chain.length);
  return { values: [...closure.keys()].sort(byText), claims: [...used], hops };
}

function closureChecks(model, edges, claims, all) {
  const usable = edges.filter((edge) =>
    claims.has(edgeClaim(edge, "consumer")),
  );
  const checks = [];
  for (const repo of model.repos) {
    const impact = closureFacts(
      impactClosure(repo.slug, usable),
      impactClosure(repo.slug, all),
    );
    if (impact) {
      checks.push(
        makeCheck(
          "impact",
          "impact",
          repo.slug,
          repo.slug,
          `Which selected repositories can a change in \`${repo.slug}\` affect through declared dependencies?`,
          { type: "set", values: impact.values },
          { claims: impact.claims },
          impact.hops,
        ),
      );
    }
    const reach = closureFacts(
      dependencyClosure(repo.slug, usable),
      dependencyClosure(repo.slug, all),
    );
    // Only worth asking when the answer goes past the direct dependencies.
    if (reach && reach.hops >= 2) {
      checks.push(
        makeCheck(
          "transitive-dependencies",
          "trace",
          repo.slug,
          repo.slug,
          `Which selected repositories does \`${repo.slug}\` depend on, directly or through others?`,
          { type: "set", values: reach.values },
          { claims: reach.claims },
          reach.hops,
        ),
      );
    }
  }
  return checks;
}

module.exports = { closureChecks, dependencyChecks };
