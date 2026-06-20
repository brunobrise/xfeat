const fs = require("fs/promises");
const path = require("path");
const fg = require("fast-glob");
const { lineForIndex } = require("./professional-docs-symbols");
const {
  componentRank,
  dependencyFlows,
  entrypointCandidates,
  exportedSymbols,
  importantFileReason,
  importantFileScore,
  importSpecs,
  publicApiScore,
  resolveLocalImport,
} = require("./professional-docs-graph");

const IGNORED_DIRS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.xfeat/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function safeDocName(name) {
  return (
    name
      .replace(/^@/, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "") || "root"
  );
}

function evidence(file, text, pattern) {
  const index =
    typeof pattern === "string" ? text.indexOf(pattern) : text.search(pattern);
  return { file, line: index >= 0 ? lineForIndex(text, index) : 1 };
}

async function readText(targetDir, file) {
  try {
    return await fs.readFile(path.join(targetDir, file), "utf8");
  } catch {
    return "";
  }
}

async function readJson(targetDir, file) {
  const text = await readText(targetDir, file);
  if (!text) return null;
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return null;
  }
}

function readmeInfo(text) {
  const lines = text.split("\n");
  const titleLine = lines.find((line) => /^#\s+/.test(line.trim()));
  const summaryLine = lines.find((line) => {
    const trimmed = line.trim();
    return (
      trimmed &&
      !/^-{3,}$/.test(trimmed) &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("<") &&
      !trimmed.startsWith(">") &&
      !trimmed.startsWith("[") &&
      !trimmed.startsWith("!") &&
      !trimmed.startsWith("*")
    );
  });
  return {
    title: titleLine ? titleLine.replace(/^#\s+/, "").trim() : "",
    summary: summaryLine ? summaryLine.trim() : "",
  };
}

async function loadManifests(targetDir) {
  const files = await fg(["**/package.json"], {
    cwd: targetDir,
    absolute: false,
    dot: true,
    ignore: IGNORED_DIRS,
    onlyFiles: true,
  });
  const manifests = [];
  for (const file of files.sort()) {
    const parsed = await readJson(targetDir, normalizePath(file));
    if (!parsed) continue;
    const dir = normalizePath(path.dirname(file));
    const name =
      parsed.data.name || (dir === "." ? "root" : path.basename(dir));
    manifests.push({
      file: normalizePath(file),
      dir,
      name,
      slug: safeDocName(name),
      description: parsed.data.description || "",
      scripts: parsed.data.scripts || {},
      dependencies: parsed.data.dependencies || {},
      main: parsed.data.main || "",
      exports: parsed.data.exports || null,
      bin: parsed.data.bin || null,
      workspaces: parsed.data.workspaces || [],
      text: parsed.text,
    });
  }
  return manifests.sort((a, b) => b.dir.length - a.dir.length);
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

function scriptLine(manifest, name) {
  return evidence(
    manifest.file,
    manifest.text,
    new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`),
  ).line;
}

function scriptTitle(name) {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildHowTos(manifests, facts) {
  const root =
    manifests.find((manifest) => manifest.file === "package.json") ||
    manifests[0];
  if (!root) return [];
  const testFiles = facts.filter((fact) =>
    /(?:^|[./-])(test|spec)\.[jt]sx?$/.test(fact.file),
  );
  return Object.entries(root.scripts).map(([name, command]) => ({
    name,
    slug: safeDocName(name),
    title: `How To ${scriptTitle(name)}`,
    command: `npm run ${name}`,
    rawCommand: command,
    evidence: { file: root.file, line: scriptLine(root, name) },
    testFiles: name.includes("test") ? testFiles.map((fact) => fact.file) : [],
  }));
}

function buildComponents(facts, manifests, imports, fanIn) {
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

  for (const manifest of manifests)
    ensure(manifest.name, manifest, manifest.dir);
  for (const fact of facts) {
    const manifest = manifestForFile(fact.file, manifests);
    const name = manifest ? manifest.name : fallbackComponent(fact.file);
    fact.semanticComponent = name;
    ensure(
      name,
      manifest,
      manifest ? manifest.dir : fallbackComponent(fact.file),
    ).facts.push(fact);
  }

  for (const fact of facts) {
    const component = ensure(fact.semanticComponent);
    const entrypoints = component.manifest
      ? entrypointCandidates(component.manifest)
      : [];
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
    const entrypoints = component.manifest
      ? entrypointCandidates(component.manifest)
      : [];
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
  return [...byName.values()]
    .filter((component) => component.facts.length || component.manifest)
    .sort(
      (a, b) =>
        componentRank(a) - componentRank(b) || a.name.localeCompare(b.name),
    );
}

async function buildSemanticModel(targetDir, facts) {
  const manifests = await loadManifests(targetDir);
  const readmeText = await readText(targetDir, "README.md");
  const readme = readmeInfo(readmeText);
  const factsByFile = new Map(facts.map((fact) => [fact.file, fact]));
  const fanIn = new Map();
  const imports = [];

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
        fromComponent: "",
        toComponent: "",
      });
    }
  }

  imports.push(...dependencyFlows(manifests));

  const provisionalManifests = manifests.length ? manifests : [];
  for (const fact of facts) {
    const manifest = manifestForFile(fact.file, provisionalManifests);
    fact.semanticComponent = manifest
      ? manifest.name
      : fallbackComponent(fact.file);
  }
  for (const flow of imports) {
    if (flow.type === "dependency") continue;
    flow.fromComponent = factsByFile.get(flow.from).semanticComponent;
    flow.toComponent = factsByFile.get(flow.to).semanticComponent;
  }

  const components = buildComponents(facts, manifests, imports, fanIn);
  const howTos = buildHowTos(manifests, facts);
  return {
    readme: {
      title: readme.title,
      summary: readme.summary,
      evidence: readmeText
        ? evidence("README.md", readmeText, readme.title || readme.summary)
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
