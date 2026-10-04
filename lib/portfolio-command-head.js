const path = require("path");

// The command head is the program and the subcommand words that state what a
// command line does. Arguments, flag values, quoted data, and later pipeline
// stages are dropped, so `docker tag "$IMAGE:test"` does not read as a test.

const OPERATORS = new Set(["&&", "||", "|", ";", "&"]);
const SHELLS = new Set(["bash", "sh", "zsh"]);
const INTERPRETERS = new Set([
  ...SHELLS,
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
]);
const PREFIXES = new Set([
  "env",
  "time",
  "nice",
  "xvfb-run",
  "npx",
  "bunx",
  "uvx",
]);
const RUNNERS = new Set([
  "uv run",
  "poetry run",
  "pipenv run",
  "hatch run",
  "pdm run",
  "pipx run",
  "pnpm exec",
  "pnpm dlx",
  "yarn dlx",
  "bundle exec",
]);
// Flags that take the next word as their value, so it is not a subcommand.
const VALUE_FLAGS = new Set([
  "-C",
  "-f",
  "-F",
  "-w",
  "-p",
  "--prefix",
  "--filter",
  "--workspace",
  "--dir",
  "--cwd",
  "--directory",
  "--file",
  "--package",
  "--manifest-path",
  "--project",
]);
const MAX_SUBCOMMANDS = 2;

// Splits on whitespace outside quotes and parentheses, so `$(find a b)` and
// `+=(x y)` stay one token. Quoted tokens keep their quotes.
function tokenize(command) {
  const tokens = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (const char of command) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      current += char;
      quote = char;
    } else if (char === "(" || char === ")") {
      current += char;
      depth = Math.max(0, depth + (char === "(" ? 1 : -1));
    } else if (/\s/.test(char) && !depth) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function unquote(token) {
  return /^(["']).*\1$/s.test(token) ? token.slice(1, -1) : token;
}

const isFlag = (token) => /^[-+]/.test(token);
const isAssignment = (token) => /^[A-Za-z_]\w*\+?=/.test(token);

function firstStage(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (OPERATORS.has(token)) break;
    if (/^\d*[<>]/.test(token)) {
      // `> file` names its target in the next token; `>file` and `2>&1` do not.
      if (/^\d*[<>]+&?$/.test(token)) i += 1;
      continue;
    }
    out.push(token);
  }
  while (out.length && isAssignment(out[0])) out.shift();
  return out;
}

function skipFlags(tokens) {
  let i = 0;
  while (i < tokens.length && (isFlag(tokens[i]) || isAssignment(tokens[i]))) {
    i += VALUE_FLAGS.has(tokens[i]) ? 2 : 1;
  }
  return tokens.slice(i);
}

// Removes wrappers until the real program leads. Returns null when the
// command hands a quoted script to a shell, which is categorized on its own.
function unwrap(tokens) {
  for (;;) {
    const name = path.posix.basename(tokens[0] || "");
    if (SHELLS.has(name) && tokens[1] === "-c" && tokens[2]) {
      return { script: unquote(tokens[2]) };
    }
    if (RUNNERS.has(`${name} ${tokens[1]}`)) {
      tokens = skipFlags(tokens.slice(2));
    } else if (PREFIXES.has(name)) {
      tokens = skipFlags(tokens.slice(1));
    } else if (INTERPRETERS.has(name)) {
      let rest = tokens.slice(1);
      while (rest.length && isFlag(rest[0]) && rest[0] !== "-m") {
        rest = rest.slice(1);
      }
      if (rest[0] === "-m") rest = rest.slice(1);
      if (!rest.length || isFlag(rest[0])) return { tokens };
      tokens = rest;
    } else {
      return { tokens };
    }
  }
}

function commandHead(command) {
  const unwrapped = unwrap(firstStage(tokenize(String(command || ""))));
  if (unwrapped.script !== undefined) return commandHead(unwrapped.script);
  const [program, ...args] = unwrapped.tokens;
  // Variables, quoted programs, and subshells name no program.
  if (!program || /^["'$(]/.test(program)) return "";
  const base = path.posix.basename(program);
  // A script path or dotted module takes arguments, not subcommands.
  if (base.includes(".")) return program;
  const head = [base];
  for (let i = 0; i < args.length && head.length <= MAX_SUBCOMMANDS; ) {
    const token = args[i];
    // Before the first subcommand every flag is skipped (`make -j4 check`).
    // After it, only flags known to take a value are (`docker compose -f x
    // build`); any other flag ends the head (`docker run --name test`).
    if (isFlag(token)) {
      if (VALUE_FLAGS.has(token)) i += 2;
      else if (head.length === 1) i += 1;
      else break;
      continue;
    }
    if (!/^[A-Za-z0-9][\w:.+-]*$/.test(token)) break;
    head.push(token);
    i += 1;
  }
  return head.join(" ");
}

module.exports = { commandHead, tokenize };
