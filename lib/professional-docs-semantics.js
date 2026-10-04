const fs = require("fs/promises");
const path = require("path");
const { readmeSummary } = require("./portfolio-signals");
const { exportedSymbols } = require("./professional-docs-exports");
const {
  componentRank,
  importantFileReason,
  importantFileScore,
  importSpecs,
  publicApiScore,
  resolveLocalImport,
} = require("./professional-docs-graph");
const {
  dependencyFlows,
  loadManifests,
} = require("./professional-docs-manifests");

function safeDocName(name) {
  return (
    name
      .replace(/^@/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "") || "root"
  );
}

// Page names must differ even on case-insensitive filesystems: npm
// `@acme/core` and Cargo `acme-core` both slug to `acme-core`.
function uniqueSlugs(items) {
  const used = new Set();
  for (const item of items) {
    let slug = item.slug;
    if (used.has(slug.toLowerCase()) && item.dir) {
      slug = safeDocName(`${item.slug}-${item.dir}`);
    }
    for (let count = 2; used.has(slug.toLowerCase()); count += 1) {
      slug = `${item.slug}-${count}`;
    }
    used.add(slug.toLowerCase());
    item.slug = slug;
  }
  return items;
}

async function readText(targetDir, file) {
  try {
    return await fs.readFile(path.join(targetDir, file), "utf8");
  } catch {
    return "";
  }
}

function manifestForFile(file, manifests) {
  return manifests.find((manifest) => {
    if (manifest.dir === ".") return true;
    return file === manifest.dir || file.startsWith(`${manifest.dir}/`);
  });
}

function fallbackComponent(file) {
  const first = file.split("/")[0] || "root";
  return first.includes(".") ? "root" : first;
}

function sourceExcerpt(fact) {
  const lines = fact.text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  return lines.join("\n");
}

function scriptTitle(name) {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

// How-to guides run from the repository root, so only root package.json
// scripts qualify.
function buildHowTos(manifests, facts) {
  const root = manifests.find((manifest) => manifest.file === "package.json");
  if (!root) return [];
  const testFiles = facts.filter((fact) =>
    /(?:^|[./-])(test|spec)\.[jt]sx?$/.test(fact.file),
  );
  return root.scripts.map((script) => ({
    name: script.name,
    slug: safeDocName(script.name),
    title: `How To ${scriptTitle(script.name)}`,
    command: `npm run ${script.name}`,
    rawCommand: script.command,
    evidence: { file: root.file, line: script.line || 1 },
    testFiles: script.name.includes("test")
      ? testFiles.map((fact) => fact.file)
      : [],
  }));
}

function buildComponents(facts, owners, imports, fanIn) {
  const byName = new Map();
  const ensure = (name, manifest = null, dir = ".") => {
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        slug: safeDocName(name),
        dir,
        manifest,
        facts: [],
        publicApis: [],
        importantFiles: [],
        flowsOut: [],
        flowsIn: [],
      });
    }
    return byName.get(name);
  };

  for (const manifest of owners) {
    ensure(manifest.displayName, manifest, manifest.dir);
  }
  for (const fact of facts) {
    const manifest = manifestForFile(fact.file, owners);
    ensure(
      fact.semanticComponent,
      manifest,
      manifest ? manifest.dir : fallbackComponent(fact.file),
    ).facts.push(fact);
  }

  for (const fact of facts) {
    const component = ensure(fact.semanticComponent);
    const entrypoints = component.manifest?.entrypoints || [];
    component.publicApis.push(
      ...exportedSymbols(fact).map((api) => ({
        ...api,
        score: publicApiScore(fact.file, entrypoints),
      })),
    );
  }

  for (const flow of imports) {
    const source = ensure(flow.fromComponent);
    const target = ensure(flow.toComponent);
    if (flow.fromComponent !== flow.toComponent) {
      source.flowsOut.push(flow);
      target.flowsIn.push(flow);
    }
  }

  for (const component of byName.values()) {
    const seenApis = new Set();
    component.publicApis = component.publicApis
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .filter((api) => {
        const key = `${api.name}:${api.file}`;
        if (seenApis.has(key)) return false;
        seenApis.add(key);
        return true;
      });
    const entrypoints = component.manifest?.entrypoints || [];
    const ranked = component.facts
      .map((fact) => ({
        file: fact.file,
        line: 1,
        reason: importantFileReason(fact, entrypoints),
        score: importantFileScore(fact, entrypoints, fanIn),
        excerpt: sourceExcerpt(fact),
      }))
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
    component.importantFiles = ranked;
  }
  return uniqueSlugs(
    [...byName.values()]
      // An unnamed manifest without source, such as docs/requirements.txt,
      // describes tooling, not a component worth a page.
      .filter((component) => component.facts.length || component.manifest?.name)
      .sort(
        (a, b) =>
          componentRank(a) - componentRank(b) || a.name.localeCompare(b.name),
      ),
  );
}

async function buildSemanticModel(targetDir, facts) {
  const manifests = await loadManifests(targetDir);
  // Deepest folder first, so a file belongs to its closest package.
  const owners = manifests
    .filter((manifest) => manifest.owner)
    .sort((a, b) => b.dir.length - a.dir.length);
  const readmeText = await readText(targetDir, "README.md");
  const readme = readmeSummary(readmeText);
  const factsByFile = new Map(facts.map((fact) => [fact.file, fact]));
  const fanIn = new Map();
  const imports = [];

  // A plain folder never merges into a package that shares its name.
  const packageNames = new Set(owners.map((owner) => owner.displayName));
  for (const fact of facts) {
    const manifest = manifestForFile(fact.file, owners);
    const folder = fallbackComponent(fact.file);
    fact.semanticComponent = manifest
      ? manifest.displayName
      : packageNames.has(folder)
        ? `${folder} (folder)`
        : folder;
  }
  for (const fact of facts) {
    for (const item of importSpecs(fact.text)) {
      const target = resolveLocalImport(fact.file, item.spec, factsByFile);
      if (!target) continue;
      fanIn.set(target, (fanIn.get(target) || 0) + 1);
      imports.push({
        from: fact.file,
        to: target,
        spec: item.spec,
        line: item.line,
        fromComponent: fact.semanticComponent,
        toComponent: factsByFile.get(target).semanticComponent,
      });
    }
  }
  imports.push(...dependencyFlows(manifests));

  const components = buildComponents(facts, owners, imports, fanIn);
  const howTos = uniqueSlugs(buildHowTos(manifests, facts));
  return {
    readme: {
      title: readme.title,
      summary: readme.summary,
      evidence: readmeText
        ? {
            file: "README.md",
            line: readme.summary ? readme.line : readme.titleLine,
          }
        : null,
    },
    manifests,
    components,
    imports,
    howTos,
  };
}

module.exports = {
  buildSemanticModel,
  safeDocName,
};
