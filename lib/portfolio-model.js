const { collectRepoFacts } = require("./portfolio-repo-facts");
const { resolvePortfolioGraph } = require("./portfolio-edges");
const { byText } = require("./portfolio-util");

const DORMANT_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function declared(value, label, evidence = null) {
  return value ? { value, label, evidence } : null;
}

function rootManifest(repo) {
  return repo.manifests.find((m) => !m.invalid && m.dir === "." && m.name);
}

function resolvePurpose(repo) {
  const root = rootManifest(repo);
  return (
    declared(repo.description, "manifest") ||
    declared(repo.readme?.summary, "source", repo.readme?.evidence) ||
    declared(
      repo.catalog?.fields.description?.value,
      "source",
      repo.catalog?.fields.description?.evidence,
    ) ||
    declared(root?.description, "source", root?.descriptionEvidence)
  );
}

function resolveOwner(repo) {
  return (
    declared(repo.owner, "manifest") ||
    declared(
      repo.catalog?.fields.owner?.value,
      "source",
      repo.catalog?.fields.owner?.evidence,
    ) ||
    declared(
      (repo.codeowners?.owners || []).join(", "),
      "source",
      repo.codeowners?.evidence,
    )
  );
}

function resolveStatus(repo, newest) {
  const fromCatalog = repo.catalog?.fields.lifecycle;
  if (repo.lifecycle) return { value: repo.lifecycle, label: "manifest" };
  if (fromCatalog) {
    return {
      value: fromCatalog.value,
      label: "source",
      evidence: fromCatalog.evidence,
    };
  }
  if (repo.readme?.deprecation) {
    // Read directly from one README line, so it is a source fact.
    return {
      value: "deprecated",
      label: "source",
      evidence: repo.readme.deprecation.evidence,
      reason: repo.readme.deprecation.text,
    };
  }
  if (!repo.git.isRepo || !repo.git.lastCommitDate) {
    return { value: "unknown", label: "derived", reason: "no git history" };
  }
  const age = (newest - Date.parse(repo.git.lastCommitDate)) / DAY_MS;
  if (age > DORMANT_DAYS) {
    return {
      value: "dormant",
      label: "derived",
      reason: `last commit ${Math.floor(age)} days before the newest commit in this portfolio`,
    };
  }
  return {
    value: "active",
    label: "derived",
    reason: `last commit within ${DORMANT_DAYS} days of the newest commit in this portfolio`,
  };
}

function resolveSystem(repo) {
  return (
    declared(repo.system, "manifest") ||
    declared(
      repo.catalog?.fields.system?.value,
      "source",
      repo.catalog?.fields.system?.evidence,
    )
  );
}

function repoGaps(repo) {
  const gaps = [];
  const add = (code, message) => gaps.push({ repo: repo.slug, code, message });
  if (!repo.purpose) add("no-purpose", "No README summary or description.");
  if (!repo.readme) add("no-readme", "No README file at the repository root.");
  if (!repo.ownership) {
    add("no-owner", "No owner in the manifest, catalog-info, or CODEOWNERS.");
  }
  if (!repo.commands.some((command) => command.category === "test")) {
    add(
      "no-test-command",
      "No declared test command in CI, scripts, Make, or just.",
    );
  }
  if (!repo.ci.length) add("no-ci", "No CI workflow detected.");
  const license = repo.license || repo.manifests.some((m) => m.license);
  if (!license) add("no-license", "No LICENSE file or manifest license.");
  if (repo.status.value === "deprecated") {
    add("deprecated", repo.status.reason || "Declared deprecated.");
  }
  if (repo.status.value === "dormant") add("dormant", repo.status.reason);
  if (!repo.git.isRepo) add("not-git", "Folder is not a git repository.");
  if (repo.git.dirty) {
    add(
      "uncommitted-changes",
      "Working tree has uncommitted changes; links use local paths.",
    );
  }
  for (const manifest of repo.manifests.filter((m) => m.parseErrors)) {
    add(
      manifest.tooLarge ? "manifest-too-large" : "manifest-parse-error",
      manifest.tooLarge
        ? `${manifest.file} exceeds 1 MB and was not read.`
        : `${manifest.file} could not be fully parsed.`,
    );
  }
  return gaps;
}

// Local dependencies that point outside every selected repository usually
// mean a sibling repository is missing from the selection.
function unresolvedGaps(unresolved) {
  return unresolved.map((item) => ({
    repo: item.from,
    code: "unresolved-dependency",
    message: `${item.kind} ${item.dependency} resolves outside the selected repositories.`,
  }));
}

function cloneOrder(repos, edges) {
  const dependsOn = new Map(repos.map((repo) => [repo.slug, new Set()]));
  for (const edge of edges) dependsOn.get(edge.from).add(edge.to);
  const order = [];
  const done = new Set();
  let remaining = repos.map((repo) => repo.slug).sort(byText);
  while (remaining.length) {
    const ready = remaining.filter((slug) =>
      [...dependsOn.get(slug)].every((dep) => done.has(dep)),
    );
    // In a dependency cycle nothing is ready; break it alphabetically and
    // flag the entry so the page can say the order is arbitrary there.
    const next = ready.length ? ready : [remaining[0]];
    for (const slug of next) {
      order.push({ slug, cycle: !ready.length });
      done.add(slug);
    }
    remaining = remaining.filter((slug) => !done.has(slug));
  }
  return order;
}

function repoClaims(repo) {
  const claims = [];
  const add = (kind, key, text, evidence, label = "source") => {
    // Evidence in files over the size limit has no hash and cannot be verified.
    if (!evidence || evidence.hash === null) return;
    claims.push({
      id: `${repo.slug}:${kind}:${key}`,
      repo: repo.slug,
      kind,
      label,
      text,
      evidence,
    });
  };
  add("purpose", "readme", repo.purpose?.value, repo.purpose?.evidence);
  add("owner", "default", repo.ownership?.value, repo.ownership?.evidence);
  add(
    "status",
    repo.status.value,
    repo.status.value,
    repo.status.evidence,
    repo.status.label,
  );
  add(
    "license",
    repo.license?.file,
    "License file present",
    repo.license?.evidence,
  );
  for (const manifest of repo.manifests.filter((m) => !m.invalid && m.name)) {
    add(
      "manifest",
      manifest.file,
      `${manifest.ecosystem} package ${manifest.name}`,
      manifest.evidence,
    );
  }
  for (const command of repo.commands) {
    add(
      "command",
      `${command.cwd}:${command.command}`,
      command.command,
      command.evidence,
    );
  }
  for (const bin of repo.bins) add("bin", bin.name, bin.name, bin.evidence);
  for (const contract of repo.contracts) {
    add(
      "contract",
      contract.file,
      `${contract.kind} contract`,
      contract.evidence,
    );
  }
  for (const service of repo.services) {
    add(
      "service",
      `${service.file}:${service.name}`,
      service.name,
      service.evidence,
    );
  }
  return claims;
}

function edgeClaims(edges) {
  return edges.flatMap((edge) =>
    [
      ["consumer", edge.consumer],
      ["provider", edge.provider],
    ]
      .filter(([, evidence]) => evidence && evidence.hash !== null)
      .map(([side, evidence]) => ({
        id: `edge:${edge.id}:${side}`,
        repo: evidence.repo,
        kind: "edge",
        label: edge.confidence === "declared" ? "source" : "derived",
        text: `${edge.from} ${edge.kind} ${edge.to}`,
        evidence,
      })),
  );
}

function coverage(repos) {
  const total = repos.length;
  const count = (code) =>
    repos.filter((repo) => !repo.gaps.some((gap) => gap.code === code)).length;
  return Object.fromEntries(
    [
      ["owner", "no-owner"],
      ["purpose", "no-purpose"],
      ["testCommand", "no-test-command"],
      ["ci", "no-ci"],
      ["license", "no-license"],
    ].map(([key, code]) => [key, { count: count(code), total }]),
  );
}

// Builds the complete portfolio model: per-repository facts, resolved
// ownership and status, the cross-repository graph, gaps, and claims.
async function buildPortfolioModel(selection) {
  const repos = [];
  for (const repo of selection.repos) repos.push(await collectRepoFacts(repo));
  const newest = Math.max(
    0,
    ...repos.map((repo) => Date.parse(repo.git.lastCommitDate) || 0),
  );
  for (const repo of repos) {
    repo.purpose = resolvePurpose(repo);
    repo.ownership = resolveOwner(repo);
    repo.status = resolveStatus(repo, newest);
    repo.systemName = resolveSystem(repo);
    repo.gaps = repoGaps(repo);
  }
  const graph = resolvePortfolioGraph(repos);
  for (const gap of unresolvedGaps(graph.unresolved)) {
    repos.find((repo) => repo.slug === gap.repo).gaps.push(gap);
  }
  const claims = [...repos.flatMap(repoClaims), ...edgeClaims(graph.edges)];
  return {
    name: selection.name,
    description: selection.description,
    repos,
    graph,
    cloneOrder: cloneOrder(repos, graph.edges),
    coverage: coverage(repos),
    gaps: repos.flatMap((repo) => repo.gaps),
    claims,
  };
}

module.exports = { buildPortfolioModel, cloneOrder };
