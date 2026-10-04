const {
  classifyFiles,
  composeServices,
  justRecipes,
  languageFor,
  makeTargets,
  parseCodeowners,
  readmeSummary,
} = require("./lib/portfolio-signals");

describe("Portfolio repository signals", () => {
  it("extracts the full first README paragraph after badges and headings", () => {
    const summary = readmeSummary(`<p align="center"><img src="logo.png"></p>

# ai4a

[![CI](https://img.shields.io/badge/ci-passing-green)](https://ci)

\`ai4a\` is a portable Rust CLI for local coding workflows backed by a managed
Gemma runtime, selective [evidence fetching](docs/evidence.md), and
repeatable benchmark scaffolds.

## Install
`);

    expect(summary).toEqual({
      title: "ai4a",
      titleLine: 3,
      summary:
        "`ai4a` is a portable Rust CLI for local coding workflows backed by a managed Gemma runtime, selective evidence fetching, and repeatable benchmark scaffolds.",
      line: 7,
    });
  });

  it("caps long README summaries at a sentence boundary", () => {
    const long = `# Tool\n\n${"First sentence explains the tool. ".repeat(3)}${"x".repeat(400)}\n`;
    const { summary } = readmeSummary(long);

    expect(summary.length).toBeLessThanOrEqual(320);
    expect(summary.endsWith(".")).toBe(true);
  });

  it("returns empty fields when no README content exists", () => {
    expect(readmeSummary("")).toEqual({
      title: "",
      titleLine: 1,
      summary: "",
      line: 1,
    });
  });

  it("resolves default CODEOWNERS owners using the last matching catch-all rule", () => {
    const owners = parseCodeowners(
      "# owners\n* @acme/platform\n/docs/ @acme/docs\n* @acme/payments @lead\n",
    );

    expect(owners).toEqual({
      defaultOwners: ["@acme/payments", "@lead"],
      line: 4,
      rules: 3,
    });
  });

  it("lists Makefile targets and justfile recipes with lines", () => {
    expect(
      makeTargets(
        ".PHONY: build test\nVERSION := 1\nbuild: deps\n\tgo build ./...\n%.o: %.c\ntest:\n\tgo test ./...\n",
      ),
    ).toEqual([
      { name: "build", line: 3 },
      { name: "test", line: 6 },
    ]);
    expect(
      justRecipes(
        "set dotenv-load\nalias b := build\n\n# Build all\nbuild:\n  cargo build\n\ntest filter='':\n  cargo test {{filter}}\n",
      ),
    ).toEqual([
      { name: "build", line: 5 },
      { name: "test", line: 8 },
    ]);
  });

  it("lists docker compose services with image and build hints", () => {
    expect(
      composeServices(
        "version: '3'\nservices:\n  api:\n    build: ./api\n    ports:\n      - 8080:8080\n  db:\n    image: postgres:16\nvolumes:\n  data:\n",
      ),
    ).toEqual([
      { name: "api", line: 3, image: "", build: "./api" },
      { name: "db", line: 7, image: "postgres:16", build: "" },
    ]);
  });

  it("classifies tests, CI, contracts, agent context, docs, and deploy descriptors", () => {
    const groups = classifyFiles([
      ".github/workflows/ci.yml",
      ".gitlab-ci.yml",
      "AGENTS.md",
      "CLAUDE.md",
      "llms.txt",
      "Dockerfile",
      "fly.toml",
      "api/openapi.yaml",
      "proto/billing/v1/invoice.proto",
      "schema.graphql",
      "docs/adr/0001-use-postgres.md",
      "docs/guide.md",
      "src/app.test.ts",
      "pkg/server_test.go",
      "tests/test_sync.py",
      "src/main.rs",
      "cmd/gateway/main.go",
      "README.md",
    ]);

    expect(groups.ci).toEqual([".github/workflows/ci.yml", ".gitlab-ci.yml"]);
    expect(groups.agentContext).toEqual(["AGENTS.md", "CLAUDE.md", "llms.txt"]);
    expect(groups.deploy).toEqual(["Dockerfile", "fly.toml"]);
    expect(groups.contracts).toEqual([
      { kind: "openapi", file: "api/openapi.yaml" },
      { kind: "protobuf", file: "proto/billing/v1/invoice.proto" },
      { kind: "graphql", file: "schema.graphql" },
    ]);
    expect(groups.adrs).toEqual(["docs/adr/0001-use-postgres.md"]);
    expect(groups.docs).toEqual([
      "docs/adr/0001-use-postgres.md",
      "docs/guide.md",
    ]);
    expect(groups.tests).toEqual([
      "pkg/server_test.go",
      "src/app.test.ts",
      "tests/test_sync.py",
    ]);
    expect(groups.entrypoints).toEqual(["cmd/gateway/main.go", "src/main.rs"]);
  });

  it("maps file extensions to languages", () => {
    expect(languageFor("src/a.tsx")).toBe("TypeScript");
    expect(languageFor("lib/b.rs")).toBe("Rust");
    expect(languageFor("Makefile")).toBe("");
  });

  it("skips CRLF front matter before the README summary", () => {
    expect(
      readmeSummary(
        "---\r\ntitle: Tool\r\n---\r\n# Tool\r\n\r\nShips invoices to the ledger.\r\n",
      ),
    ).toMatchObject({
      title: "Tool",
      summary: "Ships invoices to the ledger.",
      line: 6,
    });
  });
});
