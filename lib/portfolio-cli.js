const {
  ciPortfolio,
  initPortfolio,
  scanPortfolio,
  verifyPortfolio,
} = require("./portfolio-docs");

const VALUE_FLAGS = {
  "--manifest": "manifest",
  "--from": "from",
  "--include": "include",
  "--exclude": "exclude",
  "--out": "out",
  "--name": "name",
};
const BOOLEAN_FLAGS = { "--render-diagrams": "renderDiagrams" };
const LIST_OPTIONS = new Set(["include", "exclude"]);
const SELECTION = ["manifest", "from", "include", "exclude", "out", "name"];
// Options each command reads; anything else is rejected instead of ignored.
const ALLOWED = {
  init: new Set([...SELECTION, "paths"]),
  scan: new Set([...SELECTION, "paths", "renderDiagrams"]),
  verify: new Set(["manifest", "out"]),
  ci: new Set(["manifest", "out"]),
};
const FLAG_FOR = Object.fromEntries(
  [...Object.entries(VALUE_FLAGS), ...Object.entries(BOOLEAN_FLAGS)].map(
    ([flag, key]) => [key, flag],
  ),
);

function checkApplicable(command, options) {
  const allowed = ALLOWED[command];
  if (!allowed) return;
  for (const [key, value] of Object.entries(options)) {
    const used = Array.isArray(value) ? value.length > 0 : Boolean(value);
    if (!used || allowed.has(key)) continue;
    if (key === "paths") {
      throw new Error(`portfolio ${command} does not take repository paths`);
    }
    throw new Error(`${FLAG_FOR[key]} does not apply to portfolio ${command}`);
  }
}

const COMMANDS = {
  init: initPortfolio,
  scan: scanPortfolio,
  verify: verifyPortfolio,
  ci: ciPortfolio,
};

function parsePortfolioArgs(args) {
  const [command = "", ...rest] = args;
  const options = { paths: [], include: [], exclude: [] };
  for (let index = 0; index < rest.length; index += 1) {
    let flag = rest[index];
    let value;
    const equals = flag.startsWith("--") ? flag.indexOf("=") : -1;
    if (equals > 0) {
      value = flag.slice(equals + 1);
      flag = flag.slice(0, equals);
    }
    if (VALUE_FLAGS[flag]) {
      if (value === undefined) {
        value = rest[index + 1];
        index += 1;
      }
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      const key = VALUE_FLAGS[flag];
      if (LIST_OPTIONS.has(key)) options[key].push(value);
      else options[key] = value;
    } else if (BOOLEAN_FLAGS[flag]) {
      options[BOOLEAN_FLAGS[flag]] = true;
    } else if (flag.startsWith("-")) {
      throw new Error(`Unknown option ${flag}`);
    } else {
      options.paths.push(flag);
    }
  }
  checkApplicable(command, options);
  return { command, options };
}

function exitCodeFor(command, result) {
  if (command === "verify" || command === "ci") return result.ok ? 0 : 1;
  return 0;
}

// Runs `xfeat portfolio <command>` and prints one JSON object. Errors are
// reported as JSON with exit code 1 so CI logs stay machine-readable.
async function runPortfolioCommand(args, io = {}) {
  const stdout =
    io.stdout || ((message) => process.stdout.write(`${message}\n`));
  let command = args[0] || "";
  try {
    const parsed = parsePortfolioArgs(args);
    command = parsed.command;
    const handler = COMMANDS[command];
    if (!handler) {
      throw new Error(
        `Unknown portfolio command "${command}". Use init, scan, verify, or ci.`,
      );
    }
    const result = await handler({ ...parsed.options, cwd: io.cwd });
    const exitCode = exitCodeFor(command, result);
    const report = { command: `portfolio ${command}`, exitCode, ...result };
    stdout(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    const report = {
      command: `portfolio ${command}`.trim(),
      exitCode: 1,
      error: error.message,
    };
    stdout(JSON.stringify(report, null, 2));
    return report;
  }
}

module.exports = { parsePortfolioArgs, runPortfolioCommand };
