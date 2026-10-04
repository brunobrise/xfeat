const path = require("path");
const { lineForIndex } = require("./professional-docs-symbols");

// Public API detection per language. Each rule follows the language's own
// visibility convention so generated docs only list what callers can use.

const JS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);

const RUST_KINDS = {
  fn: "function",
  struct: "struct",
  enum: "enum",
  trait: "trait",
  type: "type",
  const: "constant",
  static: "static",
  mod: "module",
  union: "union",
};

const GO_KINDS = { type: "type", const: "constant", var: "variable" };

const PYTHON_TEST_FILE = /^(test_.*|.*_test|conftest)\.py$/;

function jsExports(text, add) {
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
    for (const match of text.matchAll(re)) add(match[1], type, match.index);
  }
  for (const match of text.matchAll(/\bexport\s+\{([^}]+)\}/g)) {
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
}

// Leaf names of a `pub use` tree: `a::B`, `a::B as C`, `a::{B, c::D}`.
// Globs, `self`, and `_` aliases name nothing callers can see.
function rustUseNames(tree) {
  return tree
    .replace(/[{}]/g, ",")
    .split(",")
    .map((segment) => {
      const [target, alias] = segment.trim().split(/\s+as\s+/);
      return (alias || target.split("::").pop() || "").trim();
    })
    .filter(
      (name) =>
        /^[A-Za-z_]\w*$/.test(name) &&
        !["self", "super", "crate", "_"].includes(name),
    );
}

function rustExports(text, add) {
  const item =
    /^[ \t]*pub[ \t]+(?:(?:const|async|unsafe|extern(?:[ \t]+"[^"]*")?)[ \t]+)*(fn|struct|enum|trait|type|const|static|mod|union)[ \t]+(?:mut[ \t]+)?([A-Za-z_]\w*)/gm;
  for (const match of text.matchAll(item)) {
    add(match[2], RUST_KINDS[match[1]], match.index);
  }
  for (const match of text.matchAll(/^[ \t]*pub[ \t]+use[ \t]+([^;]+);/gm)) {
    for (const name of rustUseNames(match[1])) {
      add(name, "re-export", match.index);
    }
  }
}

function goExports(file, text, add) {
  if (/_test\.go$/.test(file)) return;
  for (const match of text.matchAll(/^func[ \t]+([A-Z]\w*)/gm)) {
    add(match[1], "function", match.index);
  }
  for (const match of text.matchAll(/^func[ \t]*\([^)]*\)[ \t]*([A-Z]\w*)/gm)) {
    add(match[1], "method", match.index);
  }
  for (const match of text.matchAll(/^(type|const|var)[ \t]+([A-Z]\w*)/gm)) {
    add(match[2], GO_KINDS[match[1]], match.index);
  }
  // Grouped declarations list one name per line, indented by one tab.
  for (const match of text.matchAll(
    /^(type|const|var)[ \t]*\(([\s\S]*?)^\)/gm,
  )) {
    const offset = match.index + match[0].indexOf("(") + 1;
    for (const entry of match[2].matchAll(/^\t([A-Z]\w*)/gm)) {
      add(entry[1], GO_KINDS[match[1]], offset + entry.index);
    }
  }
}

function pythonExports(file, text, add) {
  if (PYTHON_TEST_FILE.test(path.posix.basename(file))) return;
  const defined = new Map();
  const define = (name, type, index) => {
    if (!defined.has(name)) defined.set(name, { type, index });
  };
  for (const match of text.matchAll(
    /^(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)/gm,
  )) {
    define(match[1], "function", match.index);
  }
  for (const match of text.matchAll(/^class[ \t]+([A-Za-z_]\w*)/gm)) {
    define(match[1], "class", match.index);
  }
  for (const match of text.matchAll(
    /^([A-Za-z_]\w*)[ \t]*(?::[^=\n]*)?=(?!=)/gm,
  )) {
    define(match[1], "constant", match.index);
  }

  const all = /^__all__[ \t]*(?::[^=\n]*)?\+?=[ \t]*([[(])/m.exec(text);
  if (all) {
    const start = all.index + all[0].length;
    // Blank out comments (keeping offsets) so "# see (docs)" cannot end the
    // list, then stop at the closer that matches the opening bracket.
    const rest = text
      .slice(start)
      .replace(/#[^\n]*/g, (comment) => " ".repeat(comment.length));
    const end = rest.indexOf(all[1] === "[" ? "]" : ")");
    const body = end < 0 ? rest : rest.slice(0, end);
    for (const entry of body.matchAll(/["']([A-Za-z_]\w*)["']/g)) {
      const definition = defined.get(entry[1]);
      if (definition) add(entry[1], definition.type, definition.index);
      else add(entry[1], "export", start + entry.index);
    }
    return;
  }
  for (const [name, { type, index }] of defined) {
    if (name.startsWith("_")) continue;
    if (type === "constant" && !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    add(name, type, index);
  }
}

// Returns public API symbols for one scanned source fact, sorted by position.
function exportedSymbols(fact) {
  const found = [];
  const seen = new Set();
  const add = (name, type, index) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    found.push({ name, type, index });
  };
  const ext = path.extname(fact.file);
  if (JS_EXTENSIONS.has(ext)) jsExports(fact.text, add);
  else if (ext === ".rs") rustExports(fact.text, add);
  else if (ext === ".go") goExports(fact.file, fact.text, add);
  else if (ext === ".py") pythonExports(fact.file, fact.text, add);
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ name, type, index }) => ({
      name,
      type,
      file: fact.file,
      line: lineForIndex(fact.text, index),
    }));
}

module.exports = { exportedSymbols };
