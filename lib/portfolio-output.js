const path = require("path");
const { GENERATOR } = require("./portfolio-links");
const { toPosix } = require("./portfolio-files");
const {
  renderGaps,
  renderGettingStarted,
  renderIndex,
  renderLandscape,
  renderLlmsTxt,
} = require("./portfolio-renderers");
const { renderLandscapePuml } = require("./portfolio-diagrams");
const {
  integrationPairs,
  renderDecisions,
  renderDependencies,
  renderIntegration,
  renderPackages,
  renderRepoPage,
} = require("./portfolio-repo-renderers");

const SCHEMA_VERSION = 1;

function serializeRepo(repo, outDir) {
  return {
    slug: repo.slug,
    name: repo.name,
    path: toPosix(path.relative(outDir, repo.path)) || ".",
    git: repo.git,
    purpose: repo.purpose,
    ownership: repo.ownership,
    status: repo.status,
    system: repo.systemName,
    notes: repo.notes || "",
    tags: repo.tags || [],
    fileCount: repo.fileCount,
    tests: repo.tests,
    languages: repo.languages,
    manifests: repo.manifests.map((m) => ({
      ecosystem: m.ecosystem,
      file: m.file,
      name: m.name,
      role: m.role,
      invalid: Boolean(m.invalid),
      parseErrors: m.parseErrors,
      evidence: m.evidence,
    })),
    commands: repo.commands.map((c) => ({
      command: c.command,
      category: c.category,
      source: c.source,
      cwd: c.cwd,
      evidence: c.evidence,
    })),
    bins: repo.bins,
    contracts: repo.contracts,
    services: repo.services.map((s) => ({
      name: s.name,
      image: s.image,
      build: s.build,
      evidence: s.evidence,
    })),
    deploy: repo.deploy,
    ci: repo.ci,
    docs: repo.docs.length,
    adrs: repo.adrs,
    agentContext: repo.agentContext,
    gaps: repo.gaps,
  };
}

function serializeStatus(model, selection, documents) {
  const graph = model.graph;
  return `${JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      generator: GENERATOR,
      name: model.name,
      description: model.description,
      manifest: selection.manifestPath
        ? toPosix(path.relative(selection.outDir, selection.manifestPath))
        : "",
      manifestHash: selection.manifestHash || "",
      coverage: model.coverage,
      cloneOrder: model.cloneOrder,
      repos: model.repos.map((repo) => serializeRepo(repo, selection.outDir)),
      edges: graph.edges,
      ambiguous: graph.ambiguous,
      packages: graph.packages,
      sharedDependencies: graph.sharedDependencies,
      sharedContracts: graph.sharedContracts,
      claims: model.claims,
      documents: [...documents].sort(),
    },
    null,
    2,
  )}\n`;
}

function plannedDocuments(model) {
  const graph = model.graph;
  const docs = ["index.md", "getting-started.md", "landscape.md", "gaps.md"];
  if (
    graph.edges.length ||
    graph.sharedDependencies.length ||
    graph.sharedContracts.length
  ) {
    docs.push("dependencies.md");
  }
  if (graph.packages.length) docs.push("packages.md");
  if (model.repos.some((repo) => repo.adrs.length)) docs.push("decisions.md");
  return docs;
}

// Renders every page for the model. Returns page bodies keyed by output path
// and a function that serializes portfolio.json once the final document list,
// including optional rendered diagrams, is known.
function renderDocuments(model, links, selection) {
  const docs = plannedDocuments(model);
  const files = {};
  const puml = renderLandscapePuml(model);
  if (puml) files["diagrams/landscape.puml"] = puml;
  const renderers = {
    "getting-started.md": () => renderGettingStarted(model, links),
    "landscape.md": () =>
      renderLandscape(model, links, {
        puml: Boolean(puml),
        svg: Boolean(selection.renderDiagrams && puml),
      }),
    "gaps.md": () => renderGaps(model, links),
    "dependencies.md": () => renderDependencies(model, links),
    "packages.md": () => renderPackages(model, links),
    "decisions.md": () => renderDecisions(model, links),
  };
  files["index.md"] = renderIndex(model, links, docs);
  for (const doc of docs.slice(1)) files[doc] = renderers[doc]();
  for (const repo of model.repos) {
    files[`repos/${repo.slug}.md`] = renderRepoPage(repo, model, links);
  }
  for (const [file, edges] of integrationPairs(model)) {
    files[file] = renderIntegration(file, edges, model, links);
  }
  files["llms.txt"] = renderLlmsTxt(model, docs);
  for (const [file, body] of Object.entries(files)) {
    if (file.endsWith(".md") && !body.endsWith("\n")) files[file] = `${body}\n`;
  }
  return {
    files,
    status: (documents) => serializeStatus(model, selection, documents),
  };
}

module.exports = { SCHEMA_VERSION, renderDocuments };
