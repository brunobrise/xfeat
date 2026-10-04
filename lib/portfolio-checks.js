const { byText } = require("./portfolio-util");
const {
  allDependencyEdges,
  claimIndex,
  declaredEdges,
  giveaway,
  impactClosure,
  makeCheck,
  testCommands,
} = require("./portfolio-check-base");
const { closureChecks, dependencyChecks } = require("./portfolio-check-edges");

// Checks are questions whose answers come from declared, cited facts. They
// serve two readers: an engineer testing their own understanding, and an
// evaluation that grades a coding agent's answers. Package-name matches and
// ambiguous names are never used as answers, because they are not verified.
// When one of them touches a question, the question is skipped instead,
// because its declared-only answer would be incomplete.

const INACTIVE = new Set(["deprecated", "dormant"]);

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

// Programs worth asking about: cited, provided by exactly one repository, and
// not named like that repository.
function programProviders(model, claims) {
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
    .map(([name, repos]) => ({ name, slug: [...repos][0] }));
}

function binaryChecks(programs) {
  return programs.map(({ name, slug }) =>
    makeCheck(
      "binary",
      "orient",
      name,
      slug,
      `Which repository provides the program \`${name}\`?`,
      { type: "value", values: [slug] },
      { claims: [`${slug}:bin:${name}`] },
    ),
  );
}

// Two-hop joins: program -> repository -> owner or test command. The reader
// must find which repository provides the program before the second fact.
function programJoinChecks(model, programs, claims) {
  const bySlug = new Map(model.repos.map((repo) => [repo.slug, repo]));
  const checks = [];
  for (const { name, slug } of programs) {
    const repo = bySlug.get(slug);
    const bin = `${slug}:bin:${name}`;
    for (const owner of ownerChecks(repo, claims)) {
      checks.push(
        makeCheck(
          "program-owner",
          "orient",
          name,
          slug,
          `Who owns the repository that provides the program \`${name}\`?`,
          owner.answer,
          { claims: [bin, ...owner.claims], manifest: owner.manifest },
          2,
        ),
      );
    }
    // Every cited program of the repository counts as a sibling, including
    // ones that get no question of their own, or a correct answer would be
    // marked wrong. A set of names is hard to guess, unlike `npm run test`.
    const shipped = repo.bins
      .map((item) => item.name)
      .filter((other) => typeof other === "string" && other !== name)
      .filter((other) => claims.has(`${slug}:bin:${other}`));
    const siblings = [...new Set(shipped)].sort(byText);
    if (siblings.length) {
      checks.push(
        makeCheck(
          "program-siblings",
          "orient",
          name,
          slug,
          `Which other programs does the repository that provides the program \`${name}\` provide?`,
          { type: "set", values: siblings },
          { claims: [bin, ...siblings.map((other) => `${slug}:bin:${other}`)] },
          2,
        ),
      );
    }
    for (const test of testCommandChecks(repo, claims)) {
      checks.push(
        makeCheck(
          "program-test-command",
          "run",
          name,
          slug,
          `Which declared command runs the tests of the repository that provides the program \`${name}\`?`,
          test.answer,
          { claims: [bin, ...test.claims] },
          2,
        ),
      );
    }
  }
  return checks;
}

// Builds every check for the model, sorted by id so output is byte-stable.
function buildChecks(model) {
  const claims = claimIndex(model);
  const edges = declaredEdges(model);
  const all = allDependencyEdges(model);
  const programs = programProviders(model, claims);
  const checks = [
    ...model.repos.flatMap((repo) => ownerChecks(repo, claims)),
    ...binaryChecks(programs),
    ...programJoinChecks(model, programs, claims),
    ...model.repos.flatMap((repo) => testCommandChecks(repo, claims)),
    ...dependencyChecks(model, edges, claims, all),
    ...closureChecks(model, edges, claims, all),
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
