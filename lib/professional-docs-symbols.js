const path = require("path");

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

function pushSymbol(symbols, seen, name, type, line) {
  if (!name || seen.has(`${type}:${name}`)) return;
  seen.add(`${type}:${name}`);
  symbols.push({ name, type, line });
}

function symbolPatterns(ext) {
  if ([".js", ".jsx", ".ts", ".tsx"].includes(ext)) {
    return [
      { type: "class", re: /\b(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g },
      {
        type: "function",
        re: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      },
      { type: "constant", re: /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/g },
      { type: "method", re: /^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm },
    ];
  }
  if (ext === ".py") {
    return [
      { type: "class", re: /^\s*class\s+([A-Za-z_][\w]*)/gm },
      { type: "function", re: /^\s*def\s+([A-Za-z_][\w]*)/gm },
    ];
  }
  if (ext === ".go") {
    return [
      { type: "type", re: /\btype\s+([A-Za-z_][\w]*)\s+(?:struct|interface)/g },
      { type: "function", re: /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/g },
    ];
  }
  if (ext === ".rs") {
    return [
      {
        type: "type",
        re: /\b(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_][\w]*)/g,
      },
      { type: "function", re: /\b(?:pub\s+)?fn\s+([A-Za-z_][\w]*)/g },
    ];
  }
  if (ext === ".java") {
    return [
      {
        type: "class",
        re: /\b(?:public\s+)?(?:class|interface)\s+([A-Za-z_][\w]*)/g,
      },
      {
        type: "method",
        re: /\b(?:public|private|protected)\s+[\w<>\[\]]+\s+([A-Za-z_][\w]*)\s*\(/g,
      },
    ];
  }
  if (ext === ".php") {
    return [
      { type: "class", re: /\b(?:class|interface|trait)\s+([A-Za-z_][\w]*)/g },
      { type: "function", re: /\bfunction\s+([A-Za-z_][\w]*)\s*\(/g },
    ];
  }
  return [];
}

function extractSymbols(relativePath, text) {
  const symbols = [];
  const seen = new Set();
  for (const { type, re } of symbolPatterns(path.extname(relativePath))) {
    let match;
    while ((match = re.exec(text))) {
      if (
        type === "method" &&
        ["if", "for", "while", "switch"].includes(match[1])
      ) {
        continue;
      }
      pushSymbol(
        symbols,
        seen,
        match[1],
        type,
        lineForIndex(text, match.index),
      );
    }
  }
  return symbols;
}

module.exports = {
  extractSymbols,
  lineForIndex,
};
