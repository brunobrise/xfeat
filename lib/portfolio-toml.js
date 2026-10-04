// Minimal, dependency-free TOML reader for repository manifests
// (Cargo.toml, pyproject.toml). It covers tables, array tables, dotted and
// quoted keys, strings, numbers, booleans, arrays, and inline tables. Dates and
// other exotic syntax are kept as raw strings. Invalid lines are skipped and
// reported in `errors` so a malformed manifest never aborts a portfolio scan.

class TomlCursor {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  line() {
    return this.text.slice(0, this.pos).split("\n").length;
  }

  peek(offset = 0) {
    return this.text[this.pos + offset];
  }

  startsWith(token) {
    return this.text.startsWith(token, this.pos);
  }

  fail(message) {
    throw new Error(`${message} at line ${this.line()}`);
  }

  skipInline() {
    while (this.peek() === " " || this.peek() === "\t") this.pos += 1;
    if (this.peek() === "#") {
      while (this.pos < this.text.length && this.peek() !== "\n") this.pos += 1;
    }
  }

  skipAll() {
    for (;;) {
      this.skipInline();
      if (this.peek() === "\n" || this.peek() === "\r") this.pos += 1;
      else return;
    }
  }

  skipToNextLine() {
    while (this.pos < this.text.length && this.peek() !== "\n") this.pos += 1;
    if (this.peek() === "\n") this.pos += 1;
  }
}

const ESCAPES = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };

function readBasicString(cursor) {
  const multi = cursor.startsWith('"""');
  cursor.pos += multi ? 3 : 1;
  if (multi && cursor.peek() === "\n") cursor.pos += 1;
  let out = "";
  for (;;) {
    if (cursor.pos >= cursor.text.length) cursor.fail("Unterminated string");
    if (multi ? cursor.startsWith('"""') : cursor.peek() === '"') {
      cursor.pos += multi ? 3 : 1;
      return out;
    }
    const char = cursor.peek();
    if (char === "\n" && !multi) cursor.fail("Newline in string");
    if (char === "\\") {
      const next = cursor.peek(1);
      if (next === "u" || next === "U") {
        const size = next === "u" ? 4 : 8;
        const hex = cursor.text.slice(cursor.pos + 2, cursor.pos + 2 + size);
        out += String.fromCodePoint(parseInt(hex, 16));
        cursor.pos += 2 + size;
      } else {
        out += ESCAPES[next] ?? next;
        cursor.pos += 2;
      }
      continue;
    }
    out += char;
    cursor.pos += 1;
  }
}

function readLiteralString(cursor) {
  const multi = cursor.startsWith("'''");
  const close = multi ? "'''" : "'";
  cursor.pos += close.length;
  if (multi && cursor.peek() === "\n") cursor.pos += 1;
  const end = cursor.text.indexOf(close, cursor.pos);
  if (end < 0) cursor.fail("Unterminated literal string");
  const value = cursor.text.slice(cursor.pos, end);
  if (!multi && value.includes("\n")) cursor.fail("Newline in string");
  cursor.pos = end + close.length;
  return value;
}

// Keys that would reach Object.prototype through plain-object assignment.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function readKeyPart(cursor) {
  cursor.skipInline();
  let key;
  if (cursor.peek() === '"') key = readBasicString(cursor);
  else if (cursor.peek() === "'") key = readLiteralString(cursor);
  else {
    const match = /^[A-Za-z0-9_-]+/.exec(cursor.text.slice(cursor.pos));
    if (!match) cursor.fail("Invalid key");
    cursor.pos += match[0].length;
    key = match[0];
  }
  if (UNSAFE_KEYS.has(key)) cursor.fail(`Unsafe key ${key}`);
  return key;
}

function readKey(cursor) {
  const parts = [readKeyPart(cursor)];
  for (;;) {
    cursor.skipInline();
    if (cursor.peek() !== ".") return parts;
    cursor.pos += 1;
    parts.push(readKeyPart(cursor));
  }
}

function readBareValue(cursor) {
  const match = /^[^\s,\]}#]+/.exec(cursor.text.slice(cursor.pos));
  if (!match) cursor.fail("Missing value");
  cursor.pos += match[0].length;
  const raw = match[0];
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^[+-]?\d[\d_]*$/.test(raw)) return Number(raw.replace(/_/g, ""));
  if (/^[+-]?\d[\d_]*(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
    return Number(raw.replace(/_/g, ""));
  }
  return raw;
}

function readArray(cursor) {
  cursor.pos += 1;
  const values = [];
  for (;;) {
    cursor.skipAll();
    if (cursor.peek() === "]") {
      cursor.pos += 1;
      return values;
    }
    if (cursor.pos >= cursor.text.length) cursor.fail("Unterminated array");
    values.push(readValue(cursor));
    cursor.skipAll();
    if (cursor.peek() === ",") cursor.pos += 1;
    else if (cursor.peek() !== "]") cursor.fail("Expected , or ]");
  }
}

function readInlineTable(cursor) {
  cursor.pos += 1;
  const table = {};
  for (;;) {
    cursor.skipInline();
    if (cursor.peek() === "}") {
      cursor.pos += 1;
      return table;
    }
    const key = readKey(cursor);
    cursor.skipInline();
    if (cursor.peek() !== "=") cursor.fail("Expected =");
    cursor.pos += 1;
    cursor.skipInline();
    assign(table, key, readValue(cursor));
    cursor.skipInline();
    if (cursor.peek() === ",") cursor.pos += 1;
    else if (cursor.peek() !== "}") cursor.fail("Expected , or }");
  }
}

function readValue(cursor) {
  const char = cursor.peek();
  if (char === '"') return readBasicString(cursor);
  if (char === "'") return readLiteralString(cursor);
  if (char === "[") return readArray(cursor);
  if (char === "{") return readInlineTable(cursor);
  return readBareValue(cursor);
}

function assign(target, keyParts, value) {
  let node = target;
  for (const part of keyParts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[keyParts[keyParts.length - 1]] = value;
}

function tableFor(root, keyParts, isArray) {
  let node = root;
  const path = [];
  keyParts.forEach((part, index) => {
    const last = index === keyParts.length - 1;
    if (last && isArray) {
      if (!Array.isArray(node[part])) node[part] = [];
      node[part].push({});
      path.push(part, String(node[part].length - 1));
      node = node[part][node[part].length - 1];
      return;
    }
    if (Array.isArray(node[part])) {
      path.push(part, String(node[part].length - 1));
      node = node[part][node[part].length - 1];
      return;
    }
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    path.push(part);
    node = node[part];
  });
  return { node, path };
}

function parseToml(text) {
  const cursor = new TomlCursor(String(text || ""));
  const data = {};
  const lines = new Map();
  const errors = [];
  let current = { node: data, path: [] };

  while (cursor.pos < cursor.text.length) {
    cursor.skipAll();
    if (cursor.pos >= cursor.text.length) break;
    const start = cursor.pos;
    const isHeader = cursor.peek() === "[";
    try {
      if (cursor.peek() === "[") {
        const isArray = cursor.startsWith("[[");
        cursor.pos += isArray ? 2 : 1;
        const key = readKey(cursor);
        cursor.skipInline();
        if (!cursor.startsWith(isArray ? "]]" : "]")) cursor.fail("Bad table");
        cursor.pos += isArray ? 2 : 1;
        current = tableFor(data, key, isArray);
        lines.set(current.path.join("."), cursor.line());
      } else {
        const line = cursor.line();
        const key = readKey(cursor);
        cursor.skipInline();
        if (cursor.peek() !== "=") cursor.fail("Expected =");
        cursor.pos += 1;
        cursor.skipInline();
        const value = readValue(cursor);
        assign(current.node, key, value);
        // Dotted keys (`serde.workspace = true`) also define their parent
        // tables on this line, so each new prefix records it.
        const full = [...current.path, ...key];
        for (let end = current.path.length + 1; end < full.length; end += 1) {
          const prefix = full.slice(0, end).join(".");
          if (!lines.has(prefix)) lines.set(prefix, line);
        }
        lines.set(full.join("."), line);
      }
      cursor.skipInline();
      if (cursor.pos < cursor.text.length && cursor.peek() !== "\n") {
        if (cursor.peek() !== "\r") cursor.fail("Unexpected trailing content");
      }
    } catch (error) {
      errors.push(error.message);
      // Keys under a rejected table header go to a detached sink instead of
      // silently landing in the previous table.
      if (isHeader) current = { node: {}, path: ["(rejected)"] };
      cursor.pos = start;
      cursor.skipToNextLine();
    }
  }
  return { data, lines, errors };
}

module.exports = { parseToml };
