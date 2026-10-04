const fs = require("fs/promises");
const path = require("path");
const {
  DEFAULT_OUTPUT,
  discoverRepos,
  loadPortfolioSelection,
  writePortfolioManifest,
} = require("./portfolio-selection");
const { buildPortfolioModel } = require("./portfolio-model");
const { createLinker } = require("./portfolio-links");
const { checkEvidence } = require("./portfolio-evidence");
const { gitInfo } = require("./portfolio-git");
const { pathExists } = require("./portfolio-util");
const { renderDocuments } = require("./portfolio-output");
const {
  plantumlAvailable,
  renderLandscapeSvg,
} = require("./portfolio-diagrams");
const {
  isInside,
  projectedRealPath,
  removeGenerated,
  writeInside,
} = require("./portfolio-safe-fs");

const STATUS_FILE = "portfolio.json";
const DEFAULT_MANIFEST = "xfeat.portfolio.json";

async function readStatus(outDir) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(outDir, STATUS_FILE), "utf8"),
    );
  } catch {
    return null;
  }
}

async function selectionOptions(options) {
  const cwd = options.cwd || process.cwd();
  const hasSource =
    options.manifest || (options.paths || []).length || options.from;
  if (!hasSource && (await pathExists(path.join(cwd, DEFAULT_MANIFEST)))) {
    return { ...options, cwd, manifest: DEFAULT_MANIFEST };
  }
  return { ...options, cwd };
}

// Scans the selection and writes the portfolio output folder. Member
// repositories are never written to; the output folder may not live inside one.
async function scanPortfolio(options = {}) {
  const selection = await loadPortfolioSelection(
    await selectionOptions(options),
  );
  const hostOf = (dir) =>
    selection.repos.find((repo) => isInside(dir, repo.path));
  const refuseHost = (dir) => {
    const host = hostOf(dir);
    if (host) {
      throw new Error(
        `Output folder ${dir} is inside selected repository ${host.slug}. Choose an --out folder outside every selected repository.`,
      );
    }
  };
  // Check where the folder would really live before creating anything, then
  // re-check after creation, so a symlinked path cannot point into a member.
  const projected = await projectedRealPath(selection.outDir);
  refuseHost(projected);
  await fs.mkdir(projected, { recursive: true });
  selection.outDir = await fs.realpath(projected);
  refuseHost(selection.outDir);
  const warnings = [];
  selection.renderDiagrams = Boolean(options.renderDiagrams);
  if (selection.renderDiagrams && !plantumlAvailable()) {
    selection.renderDiagrams = false;
    warnings.push(
      "plantuml is not available; diagrams/landscape.svg was not rendered.",
    );
  }
  const model = await buildPortfolioModel(selection);
  const local = model.repos.filter(
    (repo) => repo.git.dirty || !repo.git.remoteUrl || !repo.git.head,
  );
  if (local.length) {
    warnings.push(
      `Links for ${local.map((repo) => repo.slug).join(", ")} point to local files because the repository has uncommitted changes, no commits, or no supported remote. Those links only work on this machine.`,
    );
  }
  const links = createLinker(selection.outDir, model.repos);
  const previous = await readStatus(selection.outDir);
  const { files, status } = renderDocuments(model, links, selection);
  const documents = Object.keys(files);
  for (const [file, body] of Object.entries(files)) {
    await writeInside(selection.outDir, file, body);
  }
  if (selection.renderDiagrams && files["diagrams/landscape.puml"]) {
    const diagram = await renderLandscapeSvg(selection.outDir);
    if (diagram.rendered) documents.push("diagrams/landscape.svg");
    if (diagram.warning) warnings.push(diagram.warning);
  }
  documents.push(STATUS_FILE);
  await writeInside(selection.outDir, STATUS_FILE, status(documents));
  const removed = [];
  for (const doc of previous?.documents || []) {
    if (typeof doc !== "string" || documents.includes(doc)) continue;
    if (await removeGenerated(selection.outDir, doc)) removed.push(doc);
  }
  return {
    outDir: selection.outDir,
    repos: model.repos.map((repo) => repo.slug),
    edges: model.graph.edges.length,
    ambiguous: model.graph.ambiguous.length,
    gaps: model.gaps.length,
    claims: model.claims.length,
    coverage: model.coverage,
    documents: [...documents].sort(),
    removed,
    warnings,
  };
}

async function outDirFor(options) {
  const cwd = options.cwd || process.cwd();
  if (options.out) return path.resolve(cwd, options.out);
  const manifest = options.manifest
    ? path.resolve(cwd, options.manifest)
    : path.join(cwd, DEFAULT_MANIFEST);
  if (await pathExists(manifest)) {
    let data = {};
    try {
      data = JSON.parse(await fs.readFile(manifest, "utf8"));
    } catch {
      data = {};
    }
    return path.resolve(path.dirname(manifest), data.output || DEFAULT_OUTPUT);
  }
  return path.resolve(cwd, DEFAULT_OUTPUT);
}

// Re-reads every cited line and compares hashes. Changed or missing evidence
// is blocking; moved lines and advanced HEADs are reported without failing.
async function verifyPortfolio(options = {}) {
  const outDir = await outDirFor(options);
  const status = await readStatus(outDir);
  const findings = [];
  const warnings = [];
  if (!status) {
    return {
      ok: false,
      outDir,
      findings: [{ type: "missing-status", path: STATUS_FILE }],
      warnings,
    };
  }
  const repoPaths = new Map();
  for (const repo of status.repos) {
    const repoPath = path.resolve(outDir, repo.path);
    repoPaths.set(repo.slug, repoPath);
    if (!(await pathExists(repoPath))) {
      findings.push({ type: "missing-repo", repo: repo.slug, path: repo.path });
      continue;
    }
    const head = gitInfo(repoPath).head;
    if (repo.git.head && head && head !== repo.git.head) {
      warnings.push({
        type: "repo-advanced",
        repo: repo.slug,
        from: repo.git.head,
        to: head,
      });
    }
  }
  for (const claim of status.claims) {
    const repoPath = repoPaths.get(claim.evidence.repo);
    if (
      !repoPath ||
      findings.some(
        (f) => f.type === "missing-repo" && f.repo === claim.evidence.repo,
      )
    )
      continue;
    const result = await checkEvidence(repoPath, claim.evidence);
    const base = {
      claim: claim.id,
      repo: claim.evidence.repo,
      file: claim.evidence.file,
      line: claim.evidence.line,
    };
    if (result.state === "missing")
      findings.push({ type: "missing-source", ...base });
    if (result.state === "changed")
      findings.push({ type: "changed-evidence", ...base });
    if (result.state === "moved")
      warnings.push({ type: "moved-evidence", ...base, newLine: result.line });
  }
  for (const doc of status.documents) {
    if (!(await pathExists(path.join(outDir, doc))))
      findings.push({ type: "missing-document", path: doc });
  }
  return {
    ok: findings.length === 0,
    outDir,
    checked: {
      repos: status.repos.length,
      claims: status.claims.length,
      documents: status.documents.length,
    },
    findings,
    warnings,
  };
}

async function auditPortfolioLinks(outDir) {
  const status = await readStatus(outDir);
  const brokenLinks = [];
  for (const doc of (status?.documents || []).filter((d) =>
    d.endsWith(".md"),
  )) {
    const absolute = path.join(outDir, doc);
    const text = await fs.readFile(absolute, "utf8").catch(() => "");
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = decodeURI(target.split("#")[0]);
      if (
        clean &&
        !(await pathExists(path.resolve(path.dirname(absolute), clean)))
      ) {
        brokenLinks.push({ file: doc, target });
      }
    }
  }
  return { ok: brokenLinks.length === 0, brokenLinks };
}

async function ciPortfolio(options = {}) {
  const verify = await verifyPortfolio(options);
  const links = await auditPortfolioLinks(verify.outDir);
  return { ok: verify.ok && links.ok, verify, links };
}

async function initPortfolio(options = {}) {
  const cwd = options.cwd || process.cwd();
  const manifestPath = path.resolve(cwd, options.manifest || DEFAULT_MANIFEST);
  const repos = options.from
    ? await discoverRepos(path.resolve(cwd, options.from), options)
    : (options.paths || []).map((repoPath) => path.resolve(cwd, repoPath));
  if (!repos.length) {
    throw new Error(
      "No repositories found. Pass --from <dir> or repository paths.",
    );
  }
  return writePortfolioManifest(manifestPath, repos, {
    name: options.name,
    output: options.out,
  });
}

module.exports = {
  DEFAULT_MANIFEST,
  STATUS_FILE,
  auditPortfolioLinks,
  ciPortfolio,
  initPortfolio,
  scanPortfolio,
  verifyPortfolio,
};
