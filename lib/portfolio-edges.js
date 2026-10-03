const path = require("path");
const { normalizePackageName } = require("./portfolio-manifests");
const { normalizeRemote } = require("./portfolio-git");
const { remoteForReference } = require("./portfolio-references");

const KIND_RANK = {
  "path-dependency": 3,
  "git-dependency": 3,
  "go-module": 3,
  "git-submodule": 3,
  "github-action": 3,
  "terraform-module": 3,
  "package-name": 1,
};

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function remoteKey(url) {
  return normalizeRemote(url).toLowerCase();
}

function providedPackages(repos) {
  const index = new Map();
  for (const repo of repos) {
    for (const manifest of repo.manifests) {
      if (manifest.invalid || !manifest.name || manifest.role === "example") {
        continue;
      }
      const key = `${manifest.ecosystem}:${normalizePackageName(manifest.ecosystem, manifest.name)}`;
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

function repoForPath(repos, absolute) {
  return repos
    .filter(
      (repo) =>
        absolute === repo.path ||
        absolute.startsWith(`${repo.path}${path.sep}`),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function providerManifest(repo, ecosystem) {
  return repo.manifests.find(
    (manifest) =>
      !manifest.invalid && manifest.name && manifest.ecosystem === ecosystem,
  );
}

class EdgeSet {
  constructor() {
    this.edges = new Map();
  }

  add(edge) {
    const key = `${edge.from}->${edge.to}:${edge.dependency}`;
    const existing = this.edges.get(key);
    if (existing && KIND_RANK[existing.kind] >= KIND_RANK[edge.kind]) return;
    this.edges.set(key, {
      id: `${edge.from}->${edge.to}:${edge.kind}:${edge.dependency}`,
      ...edge,
    });
  }

  list() {
    return [...this.edges.values()].sort(
      (a, b) =>
        byText(a.from, b.from) ||
        byText(a.to, b.to) ||
        byText(a.dependency, b.dependency),
    );
  }
}

function dependencyEdges(repo, repos, packages, remotes, edges, ambiguous) {
  const external = [];
  for (const manifest of repo.manifests) {
    for (const dep of manifest.dependencies) {
      const base = {
        from: repo.slug,
        ecosystem: manifest.ecosystem,
        consumer: dep.evidence,
      };
      if (dep.path) {
        const absolute = path.resolve(repo.path, manifest.dir, dep.path);
        const target = repoForPath(repos, absolute);
        if (target && target.slug !== repo.slug) {
          const provider = providerManifest(target, manifest.ecosystem);
          edges.add({
            ...base,
            to: target.slug,
            kind: "path-dependency",
            confidence: "declared",
            dependency: dep.path,
            provider: provider ? provider.evidence : null,
          });
        }
        if (target) continue;
      }
      if (dep.git) {
        const target = remotes.get(remoteKey(dep.git));
        if (target && target.slug !== repo.slug) {
          edges.add({
            ...base,
            to: target.slug,
            kind: "git-dependency",
            confidence: "declared",
            dependency: dep.name,
            provider: null,
          });
          continue;
        }
      }
      if (manifest.ecosystem === "go") {
        const target = repos.find(
          (other) =>
            other.slug !== repo.slug &&
            other.manifests.some(
              (m) =>
                m.ecosystem === "go" &&
                m.name &&
                (dep.name === m.name || dep.name.startsWith(`${m.name}/`)),
            ),
        );
        if (target) {
          edges.add({
            ...base,
            to: target.slug,
            kind: "go-module",
            confidence: "declared",
            dependency: dep.name,
            provider: providerManifest(target, "go").evidence,
          });
          continue;
        }
      }
      const key = `${manifest.ecosystem}:${normalizePackageName(manifest.ecosystem, dep.name)}`;
      const entry = packages.get(key);
      const providers = entry ? entry.providers.map((p) => p.repo) : [];
      if (providers.includes(repo.slug)) continue;
      if (providers.length === 1) {
        edges.add({
          ...base,
          to: providers[0],
          kind: "package-name",
          confidence: "name-match",
          dependency: dep.name,
          provider: entry.providers[0].evidence,
        });
      } else if (providers.length > 1) {
        ambiguous.push({
          from: repo.slug,
          dependency: dep.name,
          ecosystem: manifest.ecosystem,
          candidates: [...providers].sort(byText),
          consumer: dep.evidence,
        });
      } else if (!dep.workspace) {
        external.push({
          key,
          name: dep.name,
          ecosystem: manifest.ecosystem,
          repo: repo.slug,
          version: dep.version || "",
          evidence: dep.evidence,
        });
      }
    }
  }
  return external;
}

function referenceEdges(repo, remotes, edges) {
  const add = (kind, url, dependency, evidence) => {
    const target = remotes.get(remoteKey(url));
    if (!target || target.slug === repo.slug) return;
    edges.add({
      from: repo.slug,
      to: target.slug,
      kind,
      confidence: "declared",
      dependency,
      ecosystem: "",
      consumer: evidence,
      provider: null,
    });
  };
  for (const use of repo.references.actions) {
    add("github-action", remoteForReference(use.ref), use.ref, use.evidence);
  }
  for (const ref of repo.references.terraform) {
    add(
      "terraform-module",
      ref.source,
      normalizeRemote(ref.source),
      ref.evidence,
    );
  }
  for (const mod of repo.references.submodules) {
    add("git-submodule", mod.url, mod.path || mod.name, mod.evidence);
  }
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

// Resolves cross-repository relationships from declarations only. Name-only
// matches stay labeled `name-match`, and names that several selected
// repositories provide are returned as ambiguous rather than guessed.
function resolvePortfolioGraph(repos) {
  const packages = providedPackages(repos);
  const remotes = new Map();
  for (const repo of repos) {
    if (repo.git && repo.git.remoteUrl && !repo.git.prefix) {
      remotes.set(remoteKey(repo.git.remoteUrl), repo);
    }
  }
  const edges = new EdgeSet();
  const ambiguous = [];
  const external = [];
  for (const repo of repos) {
    external.push(
      ...dependencyEdges(repo, repos, packages, remotes, edges, ambiguous),
    );
    referenceEdges(repo, remotes, edges);
  }
  return {
    edges: edges.list(),
    ambiguous: ambiguous.sort(
      (a, b) => byText(a.from, b.from) || byText(a.dependency, b.dependency),
    ),
    packages: [...packages.values()]
      .map((entry) => ({
        key: entry.key,
        ecosystem: entry.ecosystem,
        name: entry.name,
        repos: entry.providers.map((p) => p.repo).sort(byText),
        evidence: entry.providers.map((p) => p.evidence),
      }))
      .sort((a, b) => byText(a.key, b.key)),
    sharedDependencies: sharedDependencies(external),
    sharedContracts: sharedContracts(repos),
  };
}

module.exports = { resolvePortfolioGraph };
