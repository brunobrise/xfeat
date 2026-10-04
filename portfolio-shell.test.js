const { ciCommands } = require("./lib/portfolio-commands");

// Each case is a `run: |` block and the commands a developer could run from
// it. Cases come from an independent review of CI command extraction.
const workflow = (lines) =>
  `jobs:\n  test:\n    steps:\n      - run: |\n${lines
    .map((line) => `          ${line}`)
    .join("\n")}\n`;
const commands = (lines) =>
  ciCommands(".github/workflows/ci.yml", workflow(lines)).map((c) => c.command);

describe("CI shell block reading", () => {
  it.each([
    [
      "env prefixes with quoted values",
      [
        `RUSTFLAGS="-D warnings" cargo test --all`,
        `NODE_OPTIONS='--max-old-space-size=4096' npm test`,
        `GOFLAGS="-mod=mod" go test ./...`,
      ],
      [
        `RUSTFLAGS="-D warnings" cargo test --all`,
        `NODE_OPTIONS='--max-old-space-size=4096' npm test`,
        `GOFLAGS="-mod=mod" go test ./...`,
      ],
    ],
    [
      "a double quote inside single quotes",
      [
        `VERSION=$(node -p "require('./package.json').version" | tr -d '"')`,
        "npm test",
        "npm run lint",
      ],
      ["npm test", "npm run lint"],
    ],
    [
      "sed with a quote in single quotes",
      [`sed -i 's/"//g' out.txt`, "npm test"],
      [`sed -i 's/"//g' out.txt`, "npm test"],
    ],
    [
      "here-strings",
      [`grep -q main <<< "main dev"`, `tr a-z A-Z <<< "$LINE"`, "npm test"],
      [`grep -q main <<< "main dev"`, `tr a-z A-Z <<< "$LINE"`, "npm test"],
    ],
    [
      "scripts that start with test",
      ["test/run-integration.sh", "test.sh --ci", "test -f dist/app"],
      ["test/run-integration.sh", "test.sh --ci"],
    ],
    [
      "a comment that mentions a heredoc",
      ["# write results with cat <<EOF", "npm test"],
      ["npm test"],
    ],
    [
      "indented and escaped heredoc delimiters",
      [
        "cat <<-EOF > f",
        "npm test",
        "EOF",
        "cat <<\\EOF > g",
        "npm test",
        "EOF",
        "make test",
      ],
      ["make test"],
    ],
    ["an arithmetic shift", ["echo $((1<<BITS))", "npm test"], ["npm test"]],
    [
      "a multi-line command substitution",
      ["OUT=$(", "npm test", ")", "make test"],
      ["npm test", "make test"],
    ],
    [
      "a quote opened on a continued line",
      [`git commit -m "wip \\`, `more"`, "npm test"],
      [`git commit -m "wip more"`, "npm test"],
    ],
    [
      "bare assignments next to prefixed commands",
      ["X=1", "X=$(date)", "CI=true npm test", `FOO=bar BAR="x y" npm test`],
      ["CI=true npm test", `FOO=bar BAR="x y" npm test`],
    ],
    [
      "a heredoc fed to a shell",
      ["bash <<EOF", "npm test", "EOF", "make lint"],
      ["bash <<EOF", "npm test", "make lint"],
    ],
    [
      "a heredoc body with an unbalanced quote",
      ["python - <<'PY'", 'print("don\'t")', "x = '", "PY", "npm test"],
      ["python - <<'PY'", "npm test"],
    ],
  ])("reads %s", (_name, lines, expected) => {
    expect(commands(lines)).toEqual(expected);
  });
});
