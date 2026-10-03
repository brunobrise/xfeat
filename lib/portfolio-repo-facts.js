const fs = require("fs/promises");
const path = require("path");
const { listRepoFiles } = require("./portfolio-files");
const { gitInfo, parseGitmodules } = require("./portfolio-git");
const { readRepoManifests } = require("./portfolio-manifests");
const {
  classifyFiles,
  composeServices,
  justRecipes,
  languageFor,
  makeTargets,
  parseCodeowners,
  readmeSummary,
} = require("./portfolio-signals");
const { ciCommands, collectCommands } = require("./portfolio-commands");
const {
  actionUses,
  parseCatalogInfo,
  protoPackage,
  terraformSources,
} = require("./portfolio-references");
const { evidenceReader } = require("./portfolio-evidence");

const README = /^readme(\.(md|markdown|rst|txt))?$/i;
const LICENSE = /^(licen[cs]e|copying)(\.[\w-]+)?$/i;
const CODEOWNERS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];
const CATALOG = /^catalog-info\.ya?ml$/;
const MAKEFILE = /^([^/]+\/)?(GNUmakefile|Makefile|makefile)$/;
const JUSTFILE = /^([^/]+\/)?(justfile|Justfile|\.justfile)$/;
const COMPOSE = /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/;
const DEPRECATION =
  /(no longer (actively )?maintained|\bunmaintained\b|this (project|repository|repo|package|library|tool) (is|has been) (now )?(deprecated|archived)|^\W*(deprecated|archived)\b)/i;
const MAX_REFERENCE_FILES = 200;

async function languageStats(repoDir, files) {
  const stats = new Map();
  for (const file of files) {
    const name = languageFor(file);
    if (!name) continue;
    let size = 0;
    try {
      size = (await fs.stat(path.join(repoDir, file))).size;
    } catch {
      continue;
    }
    const entry = stats.get(name) || { name, files: 0, bytes: 0 };
    entry.files += 1;
    entry.bytes += size;
    stats.set(name, entry);
  }
  return [...stats.values()].sort(
    (a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : 1),
  );
}

async function readmeFacts(files, reader) {
  const file = files.find((item) => README.test(item));
  if (!file) return null;
  const info = readmeSummary(await reader.text(file));
  const lines = (await reader.text(file)).split("\n").slice(0, 40);
  const deprecatedIndex = lines.findIndex((line) => DEPRECATION.test(line));
  return {
    file,
    title: info.title,
    summary: info.summary,
    evidence: info.summary ? await reader.cite(file, info.line) : null,
    deprecation:
      deprecatedIndex >= 0
        ? {
            text: lines[deprecatedIndex].trim(),
            evidence: await reader.cite(file, deprecatedIndex + 1),
          }
        : null,
  };
}

async function ownershipFacts(files, reader) {
  const codeownersFile = CODEOWNERS.find((file) => files.includes(file));
  let codeowners = null;
  if (codeownersFile) {
    const parsed = parseCodeowners(await reader.text(codeownersFile));
    codeowners = {
      file: codeownersFile,
      owners: parsed.defaultOwners,
      evidence: await reader.cite(codeownersFile, parsed.line),
    };
  }
  const catalogFile = files.find((file) => CATALOG.test(file));
  let catalog = null;
  if (catalogFile) {
    const fields = parseCatalogInfo(await reader.text(catalogFile));
    catalog = { file: catalogFile, fields: {} };
    for (const [key, field] of Object.entries(fields)) {
      catalog.fields[key] = {
        value: field.value,
        evidence: await reader.cite(catalogFile, field.line),
      };
    }
  }
  return { codeowners, catalog };
}

async function commandFacts(files, manifests, groups, reader) {
  const withFile = (items, file) => items.map((item) => ({ ...item, file }));
  const make = [];
  for (const file of files.filter((item) => MAKEFILE.test(item))) {
    make.push(...withFile(makeTargets(await reader.text(file)), file));
  }
  const just = [];
  for (const file of files.filter((item) => JUSTFILE.test(item))) {
    just.push(...withFile(justRecipes(await reader.text(file)), file));
  }
  const ci = [];
  for (const file of groups.ci) {
    ci.push(...ciCommands(file, await reader.text(file)));
  }
  const commands = collectCommands({
    files,
    manifests,
    makeTargets: make,
    justRecipes: just,
    ci,
  });
  for (const command of commands) {
    command.evidence = await reader.cite(command.file, command.line);
  }
  return commands;
}

async function interfaceFacts(files, manifests, groups, reader) {
  const bins = [];
  for (const manifest of manifests) {
    const entries = [
      ...manifest.bins,
      ...(manifest.ecosystem === "python" ? manifest.scripts : []),
    ];
    for (const bin of entries) {
      bins.push({
        name: bin.name,
        target: bin.path || bin.command || "",
        evidence: await reader.cite(manifest.file, bin.line),
      });
    }
  }
  const contracts = [];
  for (const contract of groups.contracts) {
    const item = { ...contract, evidence: await reader.cite(contract.file, 1) };
    if (
      contract.kind === "protobuf" &&
      contracts.length < MAX_REFERENCE_FILES
    ) {
      const pkg = protoPackage(await reader.text(contract.file));
      if (pkg) {
        item.package = pkg.name;
        item.evidence = await reader.cite(contract.file, pkg.line);
      }
    }
    contracts.push(item);
  }
  const services = [];
  for (const file of files.filter((item) => COMPOSE.test(item))) {
    for (const service of composeServices(await reader.text(file))) {
      services.push({
        ...service,
        file,
        evidence: await reader.cite(file, service.line),
      });
    }
  }
  return { bins, contracts, services };
}

async function referenceFacts(files, groups, reader) {
  const actions = [];
  for (const file of groups.ci.filter((item) => item.startsWith(".github/"))) {
    for (const use of actionUses(await reader.text(file))) {
      actions.push({ ...use, evidence: await reader.cite(file, use.line) });
    }
  }
  const terraform = [];
  const tfFiles = files
    .filter((item) => item.endsWith(".tf"))
    .slice(0, MAX_REFERENCE_FILES);
  for (const file of tfFiles) {
    for (const ref of terraformSources(await reader.text(file))) {
      terraform.push({ ...ref, evidence: await reader.cite(file, ref.line) });
    }
  }
  const submodules = [];
  if (files.includes(".gitmodules")) {
    for (const mod of parseGitmodules(await reader.text(".gitmodules"))) {
      submodules.push({
        ...mod,
        evidence: await reader.cite(".gitmodules", mod.line),
      });
    }
  }
  return { actions, terraform, submodules };
}

async function manifestFacts(manifests, reader) {
  const out = [];
  for (const manifest of manifests) {
    const dependencies = [];
    for (const dep of manifest.dependencies) {
      dependencies.push({
        ...dep,
        evidence: await reader.cite(manifest.file, dep.line),
      });
    }
    out.push({
      ...manifest,
      dependencies,
      evidence: await reader.cite(manifest.file, manifest.nameLine),
      descriptionEvidence: manifest.description
        ? await reader.cite(manifest.file, manifest.descriptionLine || 1)
        : null,
    });
  }
  return out;
}

// Collects every documentation fact for one selected repository. The
// repository is only read; each fact keeps evidence with a line hash.
async function collectRepoFacts(repo) {
  const files = await listRepoFiles(repo.path);
  const git = gitInfo(repo.path);
  const reader = evidenceReader(repo.path, repo.slug);
  const manifests = await manifestFacts(
    await readRepoManifests(repo.path, files),
    reader,
  );
  const groups = classifyFiles(files);
  const licenseFile = files.find((file) => LICENSE.test(file));
  const { tracked, ...gitSummary } = git;
  return {
    ...repo,
    tracked,
    git: gitSummary,
    fileCount: files.length,
    languages: await languageStats(repo.path, files),
    readme: await readmeFacts(files, reader),
    license: licenseFile
      ? { file: licenseFile, evidence: await reader.cite(licenseFile, 1) }
      : null,
    ...(await ownershipFacts(files, reader)),
    manifests,
    commands: await commandFacts(files, manifests, groups, reader),
    ...(await interfaceFacts(files, manifests, groups, reader)),
    references: await referenceFacts(files, groups, reader),
    entrypoints: groups.entrypoints,
    ci: groups.ci,
    deploy: groups.deploy,
    docs: groups.docs,
    adrs: groups.adrs,
    agentContext: groups.agentContext,
    tests: groups.tests.length,
  };
}

module.exports = { collectRepoFacts };
