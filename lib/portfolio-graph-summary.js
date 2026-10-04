const { normalizePackageName } = require("./portfolio-manifests");
const { byText } = require("./portfolio-util");

function packageKey(ecosystem, name) {
  return `${ecosystem}:${normalizePackageName(ecosystem, name)}`;
}

// Every package or module name a selected repository provides, keyed per
// ecosystem so an npm `utils` never matches a Python `utils`.
function providedPackages(repos) {
  const index = new Map();
  for (const repo of repos) {
    for (const manifest of repo.manifests) {
      if (manifest.invalid || !manifest.name || manifest.role === "example") {
        continue;
      }
      const key = packageKey(manifest.ecosystem, manifest.name);
      if (!index.has(key)) {
        index.set(key, {
          key,
          ecosystem: manifest.ecosystem,
          name: manifest.name,
          providers: [],
        });
      }
      const entry = index.get(key);
      if (!entry.providers.some((p) => p.repo === repo.slug)) {
        entry.providers.push({ repo: repo.slug, evidence: manifest.evidence });
      }
    }
  }
  return index;
}

function packageList(packages) {
  return [...packages.values()]
    .map((entry) => ({
      key: entry.key,
      ecosystem: entry.ecosystem,
      name: entry.name,
      repos: entry.providers.map((p) => p.repo).sort(byText),
      evidence: entry.providers.map((p) => p.evidence),
    }))
    .sort((a, b) => byText(a.key, b.key));
}

function sharedDependencies(external) {
  const groups = new Map();
  for (const usage of external) {
    if (!groups.has(usage.key)) {
      groups.set(usage.key, {
        ecosystem: usage.ecosystem,
        name: usage.name,
        usages: [],
      });
    }
    const group = groups.get(usage.key);
    if (!group.usages.some((u) => u.repo === usage.repo)) {
      group.usages.push({
        repo: usage.repo,
        version: usage.version,
        evidence: usage.evidence,
      });
    }
  }
  return [...groups.values()]
    .filter((group) => group.usages.length > 1)
    .map((group) => ({
      ...group,
      usages: group.usages.sort((a, b) => byText(a.repo, b.repo)),
      drift: new Set(group.usages.map((u) => u.version)).size > 1,
    }))
    .sort(
      (a, b) => b.usages.length - a.usages.length || byText(a.name, b.name),
    );
}

function sharedContracts(repos) {
  const groups = new Map();
  for (const repo of repos) {
    for (const contract of repo.contracts) {
      if (!contract.package) continue;
      const key = `${contract.kind}:${contract.package}`;
      if (!groups.has(key)) {
        groups.set(key, {
          kind: contract.kind,
          name: contract.package,
          repos: [],
          evidence: [],
        });
      }
      const group = groups.get(key);
      if (!group.repos.includes(repo.slug)) group.repos.push(repo.slug);
      group.evidence.push(contract.evidence);
    }
  }
  return [...groups.values()]
    .filter((group) => group.repos.length > 1)
    .map((group) => ({ ...group, repos: group.repos.sort(byText) }))
    .sort((a, b) => byText(a.name, b.name));
}

module.exports = {
  packageKey,
  packageList,
  providedPackages,
  sharedContracts,
  sharedDependencies,
};
