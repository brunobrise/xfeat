const path = require("path");
const { normalizeRemote } = require("./portfolio-git");
const { toPosix } = require("./portfolio-files");
const { remoteForReference } = require("./portfolio-references");
const { byText } = require("./portfolio-util");
const {
  packageKey,
  packageList,
  providedPackages,
  sharedContracts,
  sharedDependencies,
} = require("./portfolio-graph-summary");

// A declared edge replaces a name-match edge for the same dependency.
const rank = (edge) => (edge.confidence === "declared" ? 2 : 1);

function remoteKey(url) {
  return normalizeRemote(url).toLowerCase();
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

function namedManifests(repo, ecosystem) {
  return repo.manifests.filter(
    (m) => !m.invalid && m.name && m.ecosystem === ecosystem,
  );
}

class EdgeSet {
  constructor() {
    this.edges = new Map();
  }

  add(edge) {
    const key = `${edge.from}->${edge.to}:${edge.dependency}`;
    const existing = this.edges.get(key);
    if (existing && rank(existing) === rank(edge)) {
      // Keep the first declaration as the cited consumer, and record the
      // other places that declare the same dependency so a question about
      // "the" declaring file is not asked when several files declare it.
      const where =
        edge.consumer && `${edge.consumer.file}:${edge.consumer.line}`;
      const first =
        existing.consumer &&
        `${existing.consumer.file}:${existing.consumer.line}`;
      if (where && where !== first) {
        const also = new Set([...(existing.alsoDeclaredIn || []), where]);
        existing.alsoDeclaredIn = [...also].sort(byText);
      }
      return;
    }
    if (existing && rank(existing) > rank(edge)) return;
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

// Shared state for one resolution pass, so matchers take one argument
// instead of the same handful of collections every time.
function createContext(repos) {
  const remotes = new Map();
  for (const repo of repos) {
    if (!repo.git || !repo.git.remoteUrl || repo.git.prefix) continue;
    const key = remoteKey(repo.git.remoteUrl);
    remotes.set(key, [...(remotes.get(key) || []), repo]);
  }
  return {
    repos,
    remotes,
    packages: providedPackages(repos),
    edges: new EdgeSet(),
    ambiguous: [],
    unresolved: [],
    external: [],
  };
}

function reportAmbiguous(ctx, repo, item, candidates) {
  ctx.ambiguous.push({
    from: repo.slug,
    dependency: item.dependency,
    ecosystem: item.ecosystem,
    candidates: [...new Set(candidates)].sort(byText),
    consumer: item.consumer,
  });
}

// Adds an edge when the remote matches exactly one other selected repository
// and reports ambiguity when several share it. Returns false on no match.
function matchRemote(ctx, repo, url, edge) {
  const targets = (ctx.remotes.get(remoteKey(url)) || []).filter(
    (target) => target.slug !== repo.slug,
  );
  if (targets.length === 1) {
    ctx.edges.add({ ...edge, from: repo.slug, to: targets[0].slug });
  } else if (targets.length > 1) {
    const slugs = targets.map((target) => target.slug);
    reportAmbiguous(ctx, repo, edge, slugs);
  }
  return targets.length > 0;
}

function matchPath(ctx, repo, manifest, dep, base) {
  const absolute = path.resolve(repo.path, manifest.dir, dep.path);
  const target = repoForPath(ctx.repos, absolute);
  if (!target) {
    ctx.unresolved.push({
      ...base,
      kind: "path-dependency",
      dependency: dep.path,
    });
    return;
  }
  if (target.slug === repo.slug) return;
  // Cite the manifest at the declared path, not just any manifest in the
  // target repository.
  const dir = toPosix(path.relative(target.path, absolute)) || ".";
  const candidates = namedManifests(target, manifest.ecosystem);
  const provider = candidates.find((m) => m.dir === dir) || candidates[0];
  ctx.edges.add({
    ...base,
    to: target.slug,
    kind: "path-dependency",
    confidence: "declared",
    dependency: dep.path,
    provider: provider ? provider.evidence : null,
  });
}

// Go module paths are hierarchical, so the longest provided module path that
// prefixes the requirement wins. Equal longest paths in several repositories
// (forks, copies) are ambiguous. Returns false when nothing matches.
function matchGo(ctx, repo, dep, base) {
  let best = [];
  for (const other of ctx.repos) {
    if (other.slug === repo.slug) continue;
    for (const m of namedManifests(other, "go")) {
      if (m.role === "example") continue;
      if (dep.name !== m.name && !dep.name.startsWith(`${m.name}/`)) continue;
      if (!best.length || m.name.length > best[0].manifest.name.length) {
        best = [{ repo: other, manifest: m }];
      } else if (m.name.length === best[0].manifest.name.length) {
        best.push({ repo: other, manifest: m });
      }
    }
  }
  const slugs = [...new Set(best.map((item) => item.repo.slug))];
  if (slugs.length > 1) {
    reportAmbiguous(ctx, repo, { ...base, dependency: dep.name }, slugs);
  } else if (slugs.length === 1) {
    ctx.edges.add({
      ...base,
      to: slugs[0],
      kind: "go-module",
      confidence: "declared",
      dependency: dep.name,
      provider: best[0].manifest.evidence,
    });
  }
  return slugs.length > 0;
}

function matchName(ctx, repo, manifest, dep, base) {
  const key = packageKey(manifest.ecosystem, dep.name);
  const entry = ctx.packages.get(key);
  const providers = entry ? entry.providers.map((p) => p.repo) : [];
  if (providers.includes(repo.slug)) return;
  if (providers.length === 1) {
    ctx.edges.add({
      ...base,
      to: providers[0],
      kind: "package-name",
      confidence: "name-match",
      dependency: dep.name,
      provider: entry.providers[0].evidence,
    });
  } else if (providers.length > 1) {
    reportAmbiguous(ctx, repo, { ...base, dependency: dep.name }, providers);
  } else if (!dep.workspace) {
    ctx.external.push({
      key,
      name: dep.name,
      ecosystem: manifest.ecosystem,
      repo: repo.slug,
      version: dep.version || "",
      evidence: dep.evidence,
    });
  }
}

function dependencyEdges(ctx, repo) {
  for (const manifest of repo.manifests) {
    for (const dep of manifest.dependencies) {
      const base = {
        from: repo.slug,
        ecosystem: manifest.ecosystem,
        consumer: dep.evidence,
      };
      if (dep.path) {
        matchPath(ctx, repo, manifest, dep, base);
        continue;
      }
      if (dep.git) {
        const edge = {
          ...base,
          kind: "git-dependency",
          confidence: "declared",
          dependency: dep.name,
          provider: null,
        };
        if (matchRemote(ctx, repo, dep.git, edge)) continue;
      }
      if (manifest.ecosystem === "go" && matchGo(ctx, repo, dep, base)) {
        continue;
      }
      matchName(ctx, repo, manifest, dep, base);
    }
  }
}

function referenceEdge(kind, dependency, evidence) {
  return {
    kind,
    confidence: "declared",
    dependency,
    ecosystem: "",
    consumer: evidence,
    provider: null,
  };
}

function submoduleEdge(ctx, repo, mod) {
  const edge = referenceEdge(
    "git-submodule",
    mod.path || mod.name,
    mod.evidence,
  );
  if (!/^\.\.?\//.test(mod.url)) {
    matchRemote(ctx, repo, mod.url, edge);
  } else if (repo.git.remoteUrl) {
    // Git resolves relative submodule URLs against the superproject remote.
    const url = new URL(mod.url, `${repo.git.remoteUrl}/`).href;
    matchRemote(ctx, repo, url, edge);
  } else {
    const target = repoForPath(ctx.repos, path.resolve(repo.path, mod.url));
    if (!target) {
      ctx.unresolved.push({ ...edge, from: repo.slug, dependency: mod.url });
    } else if (target.slug !== repo.slug) {
      ctx.edges.add({ ...edge, from: repo.slug, to: target.slug });
    }
  }
}

function referenceEdges(ctx, repo) {
  for (const use of repo.references.actions) {
    const edge = referenceEdge("github-action", use.ref, use.evidence);
    matchRemote(ctx, repo, remoteForReference(use.ref), edge);
  }
  for (const ref of repo.references.terraform) {
    const url = normalizeRemote(ref.source);
    matchRemote(
      ctx,
      repo,
      ref.source,
      referenceEdge("terraform-module", url, ref.evidence),
    );
  }
  for (const mod of repo.references.submodules) submoduleEdge(ctx, repo, mod);
}

// Resolves cross-repository relationships from declarations only. Name-only
// matches stay labeled `name-match`; names, module paths, or remotes that
// several selected repositories share are ambiguous; local paths that leave
// the selection are unresolved. Nothing is guessed.
function resolvePortfolioGraph(repos) {
  const ctx = createContext(repos);
  for (const repo of repos) {
    dependencyEdges(ctx, repo);
    referenceEdges(ctx, repo);
  }
  const byConsumer = (a, b) =>
    byText(a.from, b.from) || byText(a.dependency, b.dependency);
  return {
    edges: ctx.edges.list(),
    ambiguous: ctx.ambiguous.sort(byConsumer),
    unresolved: ctx.unresolved.sort(byConsumer),
    packages: packageList(ctx.packages),
    sharedDependencies: sharedDependencies(ctx.external),
    sharedContracts: sharedContracts(repos),
  };
}

module.exports = { resolvePortfolioGraph };
