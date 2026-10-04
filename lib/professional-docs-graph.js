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

function componentRank(component) {
  if (component.manifest?.member) return 0;
  if (/^packages\/[^/]+$/.test(component.dir)) return 0;
  if (component.dir === ".") return 1;
  if (component.dir.includes("/examples/")) return 3;
  return 2;
}

module.exports = {
  componentRank,
  importantFileReason,
  importantFileScore,
  importSpecs,
  publicApiScore,
  resolveLocalImport,
};
