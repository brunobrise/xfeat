const PROFESSIONAL_COMMANDS = new Set([
  "init",
  "scan",
  "audit",
  "verify",
  "ci",
]);

// Returns a runner for noninteractive subcommands, or null when the arguments
// belong to the interactive AI feature-map flow. Modules load lazily so the
// subcommands never pay for Tree-sitter or Anthropic SDK startup.
function subcommandRunner(args) {
  const [first] = args;
  if (first === "portfolio") {
    return () => require("./portfolio-cli").runPortfolioCommand(args.slice(1));
  }
  if (PROFESSIONAL_COMMANDS.has(first)) {
    return () => require("./professional-docs").runProfessionalCommand(args);
  }
  return null;
}

// Sets the exit code instead of calling process.exit(): stdout to a pipe is
// asynchronous on macOS, and exiting early truncates the JSON report.
function exitWith(promise) {
  return promise
    .then((result) => {
      process.exitCode = result.exitCode || 0;
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}

module.exports = { exitWith, subcommandRunner };
