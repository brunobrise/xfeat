const path = require("path");
const { lineForIndex } = require("./professional-docs-symbols");

const LOCAL_EXTENSIONS = ["", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"];

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function importSpecs(text) {
  const specs = [];
  const patterns = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g,
    /\brequire\(["']([^"']+)["']\)/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      specs.push({ spec: match[1], line: lineForIndex(text, match.index) });
    }
  }
  return specs;
}

function resolveLocalImport(file, spec, factsByFile) {
  if (!spec.startsWith(".")) return null;
  const base = normalizePath(
    path.normalize(path.join(path.dirname(file), spec)),
  );
  const candidates = [];
  for (const ext of LOCAL_EXTENSIONS) candidates.push(`${base}${ext}`);
  for (const ext of LOCAL_EXTENSIONS.slice(1))
    candidates.push(`${base}/index${ext}`);
  return candidates.find((candidate) => factsByFile.has(candidate)) || null;
}

function exportedSymbols(fact) {
  const exports = [];
  const seen = new Set();
  const add = (name, type, index) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    exports.push({
      name,
      type,
      file: fact.file,
      line: lineForIndex(fact.text, index),
    });
  };
  const direct = [
    { type: "class", re: /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g },
    {
      type: "function",
      re: /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    },
    { type: "constant", re: /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g },
    { type: "type", re: /\bexport\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/g },
  ];
  for (const { type, re } of direct) {
    let match;
    while ((match = re.exec(fact.text))) add(match[1], type, match.index);
  }
  for (const match of fact.text.matchAll(/\bexport\s+\{([^}]+)\}/g)) {
    const exportBlock = match[1]
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rawName of exportBlock.split(",")) {
      const name = rawName
        .trim()
        .split(/\s+as\s+/i)
        .pop();
      if (!/^(?:type\s+)?[A-Za-z_$][\w$]*$/.test(name)) continue;
      add(name, "export", match.index);
    }
  }
  return exports;
}

function entrypointCandidates(manifest) {
  const entries = new Set();
  const add = (value) => {
    if (typeof value === "string") {
      const entry = value.replace(/^\.\//, "");
      entries.add(entry);
      if (entry.startsWith("dist/")) {
        entries.add(entry.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
        entries.add(entry.replace(/^dist\//, "src/").replace(/\.js$/, ".js"));
      }
    }
    if (value && typeof value === "object") Object.values(value).forEach(add);
  };
  add(manifest.main);
  add(manifest.exports);
  add(manifest.bin);
  return [...entries].map((entry) =>
    normalizePath(path.join(manifest.dir, entry)),
  );
}

function publicApiScore(file, entrypoints) {
  if (entrypoints.includes(file)) return 100;
  if (/\/src\/index\.[cm]?[jt]sx?$/.test(file)) return 90;
  if (/\/src\//.test(file)) return 60;
  if (/(^|\/)(test|tests|examples|scripts)\//.test(file)) return 5;
  return 20;
}

function importantFileScore(fact, entrypoints, fanIn) {
  const entrypoint = entrypoints.includes(fact.file);
  const sourceIndex = /\/src\/index\.[cm]?[jt]sx?$/.test(fact.file);
  const sourceFile = /\/src\//.test(fact.file);
  const exampleOrTest = /(^|\/)(test|tests|examples)\//.test(fact.file);
  return (
    (entrypoint ? 1000 : 0) +
    (sourceIndex ? 400 : 0) +
    (sourceFile ? 30 : 0) +
    (fanIn.get(fact.file) || 0) * 4 +
    fact.symbols.length -
    (exampleOrTest ? 60 : 0)
  );
}

function importantFileReason(fact, entrypoints) {
  if (entrypoints.includes(fact.file)) return "package source entrypoint";
  if (/\/src\/index\.[cm]?[jt]sx?$/.test(fact.file))
    return "source barrel entrypoint";
  if ((fact.symbols || []).length > 0) return "declares public source symbols";
  return "component source file";
}

function dependencyFlows(manifests) {
  const byName = new Map(
    manifests.map((manifest) => [manifest.name, manifest]),
  );
  const flows = [];
  for (const manifest of manifests) {
    for (const dependency of Object.keys(manifest.dependencies || {})) {
      const target = byName.get(dependency);
      if (!target) continue;
      const index = manifest.text.indexOf(`"${dependency}"`);
      flows.push({
        from: manifest.file,
        to: target.file,
        spec: dependency,
        line: index >= 0 ? lineForIndex(manifest.text, index) : 1,
        fromComponent: manifest.name,
        toComponent: target.name,
        type: "dependency",
      });
    }
  }
  return flows;
}

function componentRank(component) {
  if (/^packages\/[^/]+$/.test(component.dir)) return 0;
  if (component.dir === ".") return 1;
  if (component.dir.includes("/examples/")) return 3;
  return 2;
}

module.exports = {
  componentRank,
  dependencyFlows,
  entrypointCandidates,
  exportedSymbols,
  importantFileReason,
  importantFileScore,
  importSpecs,
  publicApiScore,
  resolveLocalImport,
};
