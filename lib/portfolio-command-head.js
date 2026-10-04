const path = require("path");

// The command head is the program and the subcommand words that state what a
// command line does. Arguments, flag values, quoted data, and later pipeline
// stages are dropped, so `docker tag "$IMAGE:test"` does not read as a test.

const OPERATORS = new Set(["&&", "||", "|", ";", "&"]);
// Stages that only prepare the shell: `cd web && npm test` is `npm test`.
const SETUP_STAGES = new Set([
  "cd",
  "pushd",
  "export",
  "set",
  "source",
  ".",
  "echo",
  "printf",
  ":",
  "true",
]);
const SHELLS = new Set(["bash", "sh", "zsh"]);
const INTERPRETERS = new Set([
  "python",
  "python3",
  "node",
  "ruby",
  "perl",
  "powershell",
  "pwsh",
]);
const POWERSHELLS = new Set(["powershell", "pwsh"]);
// Programs that run the command after their own options, durations, and
// counts: `timeout 10m npm test`, `nice -n 10 make`.
const PREFIXES = new Set([
  "env",
  "time",
  "timeout",
  "nice",
  "nohup",
  "stdbuf",
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
  "npm exec",
  "pnpm exec",
  "pnpm dlx",
  "yarn exec",
  "yarn dlx",
  "bundle exec",
  "coverage run",
]);
// Script entry points whose first argument is a subcommand.
const SUBCOMMAND_SCRIPTS = new Set(["manage.py", "setup.py"]);
// After these verbs, flags still precede the script name: `npm run -s test`.
const PASS_THROUGH = new Set(["run", "run-script", "exec"]);
// Monorepo tools name their task in a flag: `nx affected -t test`.
const TARGET_PROGRAMS = new Set(["nx", "turbo", "lerna", "cmake"]);
const TARGET_FLAG = /^(-t|--targets?)(=(.*))?$/;
// Flags that take the next word as their value, so it is not a subcommand.
const VALUE_FLAGS = new Set([
  "-C",
  "-e",
  "-f",
  "-F",
  "-w",
  "-p",
  "--env",
  "--prefix",
  "--filter",
  "--workspace",
  "--dir",
  "--cwd",
  "--directory",
  "--file",
  "--name",
  "--package",
  "--manifest-path",
  "--project",
  "--project-name",
  "--profile",
  "--python",
  "--with",
  "--group",
  "--extra",
  "--env-file",
]);
const PREFIX_VALUE_FLAGS = new Set([
  "-u",
  "--unset",
  "-n",
  "--adjustment",
  "-s",
  "--signal",
  "-k",
  "--kill-after",
]);
const INTERPRETER_VALUE_FLAGS = new Set([
  "-r",
  "--require",
  "--import",
  "--loader",
  "--experimental-loader",
  "-W",
  "-X",
  "-ExecutionPolicy",
  "-ep",
  "-WindowStyle",
]);
const RUNNER_VALUE_FLAGS = new Set([
  ...VALUE_FLAGS,
  ...INTERPRETER_VALUE_FLAGS,
]);
// Inline code (`python -c`, `node -e`) names no program.
const INLINE_CODE_FLAGS = new Set(["-c", "-e", "-p", "--eval", "--print"]);
const CONTAINER_VALUE_FLAGS = new Set([
  ...VALUE_FLAGS,
  "-u",
  "--user",
  "--workdir",
  "--entrypoint",
  "-v",
  "--volume",
  "--publish",
  "-l",
  "--label",
  "--network",
  "--net",
  "--platform",
  "--mount",
  "-h",
  "--hostname",
  "--add-host",
  "--cap-add",
  "--memory",
  "--cpus",
  "--shm-size",
  "--ulimit",
  "--gpus",
  "--runtime",
  "--pull",
  "--restart",
  "--device",
  "--tmpfs",
  "--security-opt",
]);
// `yarn workspaces foreach -A run test` runs `yarn run test` in each workspace.
const FOREACH_VALUE_FLAGS = new Set([
  "--include",
  "--exclude",
  "--from",
  "-j",
  "--jobs",
]);
const MAX_SUBCOMMANDS = 2;

// Splits on whitespace outside quotes and parentheses, so `$(find a b)` and
// `+=(x y)` stay one token. Quoted tokens keep their quotes; a backslash
// escapes the next character outside single quotes.
function tokenize(command) {
  const chars = Array.from(command);
  const tokens = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === "\\" && quote !== "'" && i + 1 < chars.length) {
      current += char + chars[i + 1];
      i += 1;
    } else if (quote) {
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
const isCount = (token) => /^\d+(\.\d+)?[smhd]?$/.test(token);

// Returns the stages joined by `&&`, `||` or `;` that do real work, without
// redirections or leading `NAME=value` assignments. Commands after a `|`
// only filter the output of the stage before them, so they are skipped.
function workStages(tokens) {
  const stages = [];
  let stage = [];
  let piped = false;
  for (let i = 0; i <= tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "|") {
      piped = true;
      continue;
    }
    if (token === undefined || OPERATORS.has(token)) {
      while (stage.length && isAssignment(stage[0])) stage.shift();
      if (stage.length && !SETUP_STAGES.has(stage[0])) stages.push(stage);
      stage = [];
      piped = false;
      continue;
    }
    if (piped) continue;
    if (/^\d*[<>]/.test(token)) {
      // `> file` names its target in the next token; `>file` and `2>&1` do not.
      if (/^\d*[<>]+&?$/.test(token)) i += 1;
      continue;
    }
    stage.push(token);
  }
  return stages;
}

function skipFlags(tokens, valueFlags = VALUE_FLAGS) {
  let i = 0;
  while (i < tokens.length && (isFlag(tokens[i]) || isAssignment(tokens[i]))) {
    i += valueFlags.has(tokens[i]) ? 2 : 1;
  }
  return tokens.slice(i);
}

// `bash -euo pipefail -c "pytest"` runs the quoted script; `bash x.sh` runs
// the script file.
function unwrapShell(tokens) {
  let command = false;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!isFlag(token)) {
      return command ? { script: unquote(token) } : { tokens: tokens.slice(i) };
    }
    if (/^[-+][A-Za-z]*o$/.test(token)) i += 1;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(token)) command = true;
  }
  return { tokens };
}

// `python -m pytest`, `node --require ts-node/register test/x.ts`, and
// runners such as `uv run --python 3.12 pytest` or `coverage run -m pytest`.
function unwrapInterpreter(tokens, runner = false) {
  const valueFlags = runner ? RUNNER_VALUE_FLAGS : INTERPRETER_VALUE_FLAGS;
  const name = path.posix.basename(tokens[0]);
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    // `powershell -File x.ps1` runs a script; `-Command "..."` runs a line.
    if (POWERSHELLS.has(name) && /^-(File|f)$/i.test(token)) {
      return { tokens: tokens.slice(i + 1) };
    }
    if (POWERSHELLS.has(name) && /^-(Command|c)$/i.test(token)) {
      return tokens[i + 1]
        ? { script: unquote(tokens[i + 1]) }
        : { tokens: [] };
    }
    // `node --check x.js` only checks syntax.
    if (name === "node" && (token === "--check" || token === "-c")) {
      return { tokens: ["check"] };
    }
    if (token === "-m") return { tokens: tokens.slice(i + 1) };
    if (!runner && INLINE_CODE_FLAGS.has(token)) return { tokens: [] };
    // `node --test` alone runs every test file it finds.
    if (!runner && token === "--test" && i === tokens.length - 1) {
      return { tokens: ["test"] };
    }
    if (!isFlag(token)) return { tokens: tokens.slice(i) };
    if (valueFlags.has(token)) i += 1;
  }
  return { tokens };
}

// `docker compose run --rm web pytest` runs `pytest` in the `web` service,
// and `docker run --rm img pytest` runs it in the image. A detached
// container (`docker run -d`) is a service the job needs, not its command.
function unwrapContainer(tokens) {
  const name = path.posix.basename(tokens[0]);
  let rest = skipFlags(tokens.slice(1));
  let compose = name === "docker-compose";
  if (name === "docker" && rest[0] === "compose") {
    compose = true;
    rest = skipFlags(rest.slice(1));
  }
  const verb = rest[0];
  if (verb !== "exec" && verb !== "run") return null;
  const options = rest.slice(1);
  const target = skipFlags(options, CONTAINER_VALUE_FLAGS);
  const flags = options.slice(0, options.length - target.length);
  const detached = flags.some((t) => t === "--detach" || /^-[a-z]*d/.test(t));
  if (detached && !compose) return null;
  const inner = target.slice(1);
  return inner.length ? { tokens: inner } : null;
}

// Removes wrappers until the real program leads. Returns `script` when the
// command hands a quoted script to a shell, which is categorized on its own.
function unwrap(tokens) {
  for (let guard = 0; guard < 20 && tokens.length; guard += 1) {
    const name = path.posix.basename(tokens[0]);
    let next = null;
    if (SHELLS.has(name)) next = unwrapShell(tokens);
    else if (INTERPRETERS.has(name)) next = unwrapInterpreter(tokens);
    else if (
      name === "yarn" &&
      tokens[1] === "workspaces" &&
      tokens[2] === "foreach"
    ) {
      next = {
        tokens: ["yarn", ...skipFlags(tokens.slice(3), FOREACH_VALUE_FLAGS)],
      };
    } else if (RUNNERS.has(`${name} ${tokens[1]}`)) {
      next = unwrapInterpreter(tokens.slice(1), true);
    } else if (PREFIXES.has(name)) {
      let rest = skipFlags(
        tokens.slice(1),
        new Set([...VALUE_FLAGS, ...PREFIX_VALUE_FLAGS]),
      );
      while (rest.length && isCount(rest[0])) rest = rest.slice(1);
      next = { tokens: rest };
    } else if (name === "docker" || name === "docker-compose") {
      next = unwrapContainer(tokens);
    }
    if (!next || next.script !== undefined || next.tokens === tokens) {
      return next || { tokens };
    }
    tokens = next.tokens;
  }
  return { tokens };
}

function subcommands(base, args) {
  const head = [base];
  let workspaceNamed = false;
  for (let i = 0; i < args.length && head.length <= MAX_SUBCOMMANDS; ) {
    const token = args[i];
    // `cmake --build dir` builds; its target names what the build runs.
    if (base === "cmake" && token === "--build") {
      head.push("build");
      i += 2;
      continue;
    }
    const target = TARGET_PROGRAMS.has(base) && TARGET_FLAG.exec(token);
    if (target) {
      const value = target[3] ?? args[i + 1] ?? "";
      if (value) head.push(value.split(",")[0]);
      i += target[2] ? 1 : 2;
      continue;
    }
    // Before the first subcommand and after `run` or `exec`, every flag is
    // skipped (`make -j4 check`, `npm run -s test`). Elsewhere only flags
    // known to take a value are (`docker compose -f x build`), and any other
    // flag ends the head (`tool sync --format json`).
    if (isFlag(token)) {
      if (VALUE_FLAGS.has(token)) i += 2;
      else if (head.length === 1 || PASS_THROUGH.has(head.at(-1))) i += 1;
      else break;
      continue;
    }
    // `yarn workspace @acme/web test` names the workspace before the script.
    if (base === "yarn" && head.at(-1) === "workspace" && !workspaceNamed) {
      workspaceNamed = true;
      i += 1;
      continue;
    }
    if (!/^[A-Za-z0-9][\w:.+-]*$/.test(token)) break;
    head.push(token);
    i += 1;
  }
  return head.join(" ");
}

function stageHead(tokens) {
  const [program, ...args] = tokens;
  // Variables, quoted programs, and subshells name no program.
  if (!program || /^["'$(]/.test(program)) return "";
  const base = path.posix.basename(program);
  if (SUBCOMMAND_SCRIPTS.has(base)) return subcommands(base, args);
  // A script path or dotted module takes arguments, not subcommands.
  if (base.includes(".")) return program;
  return subcommands(base, args);
}

// One head per working stage; a shell handed a quoted script contributes the
// heads of that script.
function commandHeads(command, depth = 0) {
  const heads = [];
  for (const stage of workStages(tokenize(String(command || "")))) {
    const unwrapped = unwrap(stage);
    if (unwrapped.script !== undefined) {
      if (depth < 5) heads.push(...commandHeads(unwrapped.script, depth + 1));
    } else {
      const head = stageHead(unwrapped.tokens);
      if (head) heads.push(head);
    }
  }
  return heads;
}

function commandHead(command) {
  return commandHeads(command)[0] || "";
}

module.exports = { commandHead, commandHeads, tokenize };
