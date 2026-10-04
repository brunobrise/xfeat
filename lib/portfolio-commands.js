const path = require("path");
const { unquote } = require("./portfolio-util");
const { commandHeads } = require("./portfolio-command-head");

const CATEGORY_RULES = [
  [
    "setup",
    /^(npm (ci|install|i)\b|pnpm (i|install)\b|yarn( install)?$|bun install|pip3? install|poetry install|uv sync|go mod download|cargo fetch|bundle install|composer install)/,
  ],
  [
    "test",
    /(^(make|gradle|gradlew) check$|\btests?\b|unittest|pytest|rspec|\bctest\b|phpunit|jest|vitest|mocha|\bspec\b|go test|cargo test|cargo nextest|\btox\b|\bnox\b)/,
  ],
  [
    "lint",
    /(lint|clippy|eslint|ruff|flake8|\bblack\b|prettier|\bfmt\b|format|typecheck|mypy|go vet|(?<!cargo )\bcheck\b)/,
  ],
  ["build", /(build|compile|\btsc\b|bundle|cargo check)/],
  [
    "run",
    /(\b(dev|start|serve|watch|preview)\b|cargo run|go run|uvicorn|flask run)/,
  ],
];

// Shell fragments, file chores, and toolchain installers that CI needs but a
// developer following the docs does not.
const NOISE =
  /^(echo|cd|export|set|source|mkdir|ls|cat|printf|true|exit|cp|mv|rm|chmod|chown|touch|ln|jq|tar|unzip|curl|wget|sudo|apt|apt-get|brew|choco|rustup|sleep|if|then|else|elif|fi|for|while|until|do|done|case|esac|function)\b|^(#|\{|\}|\[|git (config|fetch|checkout|tag|push))/;
// Shell builtins and `case` arms (`*)`, `linux|darwin)`) are script control
// flow; a word boundary would also drop real commands such as `test-runner`.
const SHELL_CONTROL =
  /^(test|local|read|shift|trap|eval|return|break|continue)(\s|$)|^[^\s()]*\)(\s|$)|^;;/;
const CI_ONLY = /\$\{\{|\$GITHUB_|\$RUNNER_/;
// Workflows that publish or deploy, rather than build and test, are skipped
// for commands but still read for cross-repository references.
const RELEASE_WORKFLOW =
  /(release|publish|deploy|backup|pages|labeler|stale|pr-title|dependabot)[^/]*$/i;

// Rules match the head of each stage with `_-./:` read as word breaks, so
// `scripts/run_tests.sh` and `npm run test:unit` are tests while arguments
// such as `--branch ci-under-test` or `"$IMAGE:test"` never count. The first
// rule any stage matches wins: `npm ci && npm test` is setup, and
// `npm run build && npx playwright test` is a test.
function categorizeCommand(command) {
  const heads = commandHeads(command).map((head) =>
    head.replace(/[_\-./:]+/g, " ").trim(),
  );
  const rule = CATEGORY_RULES.find(([, re]) =>
    heads.some((head) => re.test(head)),
  );
  return rule ? rule[0] : "other";
}

function packageRunner(files, dir) {
  const prefix = dir && dir !== "." ? `${dir}/` : "";
  const has = (name) => files.includes(`${prefix}${name}`);
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  return "npm";
}

function pushCommand(out, file, line, raw) {
  const command = unquote(raw.trim());
  if (
    !command ||
    NOISE.test(command) ||
    SHELL_CONTROL.test(command) ||
    CI_ONLY.test(command)
  ) {
    return;
  }
  out.push({ command, file, line });
}

// Reads `run:` steps. Block scalars (`run: |` or `run: >`) continue while lines
// are indented deeper than the `run:` key; `|` keeps one command per line and
// joins trailing-backslash continuations, `>` folds the block into one line.
function githubRunSteps(file, lines) {
  const out = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const value = match[2].trim();
    if (!/^[|>][+-]?$/.test(value)) {
      pushCommand(out, file, index + 1, value);
      continue;
    }
    const baseIndent = match[1].length;
    const block = [];
    let next = index + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() && line.length - line.trimStart().length <= baseIndent) {
        break;
      }
      if (line.trim()) block.push({ text: line.trim(), line: next + 1 });
    }
    if (value.startsWith(">") && block.length) {
      pushCommand(out, file, block[0].line, block.map((b) => b.text).join(" "));
    } else {
      let pending = null;
      for (const item of block) {
        const text = pending ? `${pending.text} ${item.text}` : item.text;
        const start = pending ? pending.line : item.line;
        if (text.endsWith("\\")) {
          pending = { text: text.slice(0, -1).trim(), line: start };
        } else {
          pending = null;
          pushCommand(out, file, start, text);
        }
      }
    }
    index = next - 1;
  }
  return out;
}

function gitlabScripts(file, lines) {
  const out = [];
  let scriptIndent = -1;
  lines.forEach((line, index) => {
    const indent = line.length - line.trimStart().length;
    if (/^\s*(before_script|script):\s*$/.test(line)) {
      scriptIndent = indent;
      return;
    }
    if (scriptIndent < 0) return;
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (item && indent > scriptIndent) {
      pushCommand(out, file, index + 1, item[1]);
    } else if (line.trim() && indent <= scriptIndent) {
      scriptIndent = -1;
    }
  });
  return out;
}

// Extracts shell commands executed by CI so docs can cite what actually runs,
// not what an ecosystem convention suggests might run.
function ciCommands(file, text) {
  if (RELEASE_WORKFLOW.test(file)) return [];
  const lines = String(text || "").split("\n");
  if (file.startsWith(".github/workflows/")) return githubRunSteps(file, lines);
  if (file === ".gitlab-ci.yml") return gitlabScripts(file, lines);
  return [];
}

function canonical(command) {
  return command
    .replace(/^(npm|pnpm|yarn|bun) run /, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// Merges commands from CI, package scripts, Makefile targets, and justfile
// recipes. CI wins on duplicates because it is evidence the command runs.
function collectCommands({ files, manifests, makeTargets, justRecipes, ci }) {
  const commands = [];
  const seen = new Set();
  const add = (entry) => {
    const key = `${entry.cwd}:${canonical(entry.command)}`;
    if (seen.has(key)) return;
    seen.add(key);
    commands.push({ ...entry, category: categorizeCommand(entry.command) });
  };
  for (const item of ci) {
    add({
      command: item.command,
      source: "ci",
      file: item.file,
      line: item.line,
      cwd: ".",
    });
  }
  for (const manifest of manifests) {
    if (manifest.ecosystem !== "npm") continue;
    const runner = packageRunner(files, manifest.dir);
    for (const script of manifest.scripts || []) {
      if (/^(pre|post)/.test(script.name) && script.name !== "prepare")
        continue;
      add({
        command: `${runner} run ${script.name}`,
        source: "script",
        file: manifest.file,
        line: script.line,
        cwd: manifest.dir,
        detail: script.command,
      });
    }
  }
  for (const target of makeTargets) {
    add({
      command: `make ${target.name}`,
      source: "make",
      file: target.file,
      line: target.line,
      cwd: path.posix.dirname(target.file),
    });
  }
  for (const recipe of justRecipes) {
    add({
      command: `just ${recipe.name}`,
      source: "just",
      file: recipe.file,
      line: recipe.line,
      cwd: path.posix.dirname(recipe.file),
    });
  }
  return commands.map(
    ({ command, category, source, file, line, cwd, detail }) => ({
      command,
      category,
      source,
      file,
      line,
      cwd,
      ...(detail ? { detail } : {}),
    }),
  );
}

module.exports = {
  categorizeCommand,
  ciCommands,
  collectCommands,
  packageRunner,
};
