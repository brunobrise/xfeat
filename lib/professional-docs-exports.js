const path = require("path");

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

// Returns a function mapping a text offset to its zero-based line, using a
// binary search so files with thousands of public items stay fast.
function lineIndex(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") starts.push(index + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
}

// Same-length blanks keep every offset, and so every cited line, intact.
const blank = (match) => match.replace(/[^\n]/g, " ");

// Rust comments, raw and plain strings, and char literals such as '{'.
// Go comments, raw (backtick) and interpreted strings, and rune literals.
const GO_NOISE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|`[^`]*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])+'/g;

const CFG_TEST_ATTRIBUTE =
  /#\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*(?:#\[[^\]]*\]\s*)*$/;

const RUST_NOISE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|\bb?r(#*)"[\s\S]*?"\1|(?:\bb)?"(?:\\[\s\S]|[^"\\])*"|(?:\bb)?'(?:\\.|[^'\\\n])'/g;

const RUST_OPEN_BLOCK =
  /^\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?(?:impl|trait|extern)\b/;

// Callers can see into `pub mod`, `impl`, `trait`, and `extern` blocks, never
// into private modules, `#[cfg(test)]` modules, or function bodies.
function opensVisibleBlock(header) {
  if (/#\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(header)) return false;
  if (/\bmod\s+\w+\s*$/.test(header)) {
    return /(?:^|[^\w)])pub\s+mod\s+\w+\s*$/.test(header);
  }
  return RUST_OPEN_BLOCK.test(header);
}

// One flag per line: true when every block enclosing the line is visible.
function rustVisibleLines(masked) {
  const visible = [true];
  const blocks = [];
  let headerStart = 0;
  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index];
    if (char === "\n") visible.push(blocks.every(Boolean));
    else if (char === "{") {
      blocks.push(opensVisibleBlock(masked.slice(headerStart, index)));
      headerStart = index + 1;
    } else if (char === "}" || char === ";") {
      if (char === "}") blocks.pop();
      headerStart = index + 1;
    }
  }
  return visible;
}

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

// Integration tests, benches, and examples are separate crates, not API.
function rustExports(file, text, add) {
  if (/(^|\/)(tests|benches|examples)\//.test(file)) return;
  const masked = text.replace(RUST_NOISE, blank);
  const visible = rustVisibleLines(masked);
  const lineOf = lineIndex(masked);
  const reachable = (index) => visible[lineOf(index)];
  // Strings were blanked above, so `extern "C" fn` reads as `extern     fn`.
  const item =
    /^[ \t]*pub[ \t]+(?:(?:const|async|unsafe|extern)[ \t]+)*(fn|struct|enum|trait|type|const|static|mod|union)[ \t]+(?:mut[ \t]+)?([A-Za-z_]\w*)/gm;
  for (const match of masked.matchAll(item)) {
    // `#[cfg(test)] pub mod test_support` exists only in test builds.
    const before = masked.slice(Math.max(0, match.index - 300), match.index);
    if (reachable(match.index) && !CFG_TEST_ATTRIBUTE.test(before)) {
      add(match[2], RUST_KINDS[match[1]], match.index);
    }
  }
  for (const match of masked.matchAll(/^[ \t]*pub[ \t]+use[ \t]+([^;]+);/gm)) {
    if (!reachable(match.index)) continue;
    for (const name of rustUseNames(match[1])) {
      add(name, "re-export", match.index);
    }
  }
}

// Tests, `internal/` packages, and `package main` are not importable API.
function goExports(file, source, add) {
  if (/_test\.go$/.test(file) || /(^|\/)internal\//.test(file)) return;
  const text = source.replace(GO_NOISE, blank);
  if (/^package[ \t]+main\b/m.test(text)) return;
  for (const match of text.matchAll(/^func[ \t]+([A-Z]\w*)/gm)) {
    add(match[1], "function", match.index);
  }
  // Methods count only on exported receiver types.
  for (const match of text.matchAll(
    /^func[ \t]*\(\s*(?:[A-Za-z_]\w*\s+)?\*?\s*([A-Za-z_]\w*)[^)]*\)[ \t]*([A-Z]\w*)/gm,
  )) {
    if (/^[A-Z]/.test(match[1])) add(match[2], "method", match.index);
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

// Test modules, test folders, `_private.py` modules, and modules inside a
// `_private/` package are not public API.
function pythonExports(file, source, add) {
  const base = path.posix.basename(file);
  if (PYTHON_TEST_FILE.test(base) || /(^|\/)tests?\//.test(file)) return;
  if (base.startsWith("_") && base !== "__init__.py") return;
  if (/(^|\/)_[^/]*\//.test(file)) return;
  const text = source.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, blank);
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

  const declarations = [
    ...text.matchAll(/^__all__[ \t]*(?::[^=\n]*)?\+?=[ \t]*([[(])/gm),
  ];
  for (const all of declarations) {
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
  }
  if (declarations.length) return;
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
  else if (ext === ".rs") rustExports(fact.file, fact.text, add);
  else if (ext === ".go") goExports(fact.file, fact.text, add);
  else if (ext === ".py") pythonExports(fact.file, fact.text, add);
  const lineOf = lineIndex(fact.text);
  return found
    .sort((a, b) => a.index - b.index)
    .map(({ name, type, index }) => ({
      name,
      type,
      file: fact.file,
      line: lineOf(index) + 1,
    }));
}

module.exports = { exportedSymbols };
