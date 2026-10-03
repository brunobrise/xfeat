const {
  categorizeCommand,
  ciCommands,
  collectCommands,
  packageRunner,
} = require("./lib/portfolio-commands");

describe("Portfolio command extraction", () => {
  it("extracts GitHub Actions run steps including block scalars", () => {
    const commands = ciCommands(
      ".github/workflows/ci.yml",
      `jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Test
        run: |
          echo "starting"
          npm test -- --runInBand
      - run: >-
          cargo clippy --all-targets
`,
    );

    expect(commands).toEqual([
      { command: "npm ci", file: ".github/workflows/ci.yml", line: 5 },
      {
        command: "npm test -- --runInBand",
        file: ".github/workflows/ci.yml",
        line: 9,
      },
      {
        command: "cargo clippy --all-targets",
        file: ".github/workflows/ci.yml",
        line: 11,
      },
    ]);
  });

  it("extracts GitLab script entries", () => {
    expect(
      ciCommands(
        ".gitlab-ci.yml",
        "test:\n  script:\n    - pip install -e .\n    - pytest -q\n",
      ),
    ).toEqual([
      { command: "pip install -e .", file: ".gitlab-ci.yml", line: 3 },
      { command: "pytest -q", file: ".gitlab-ci.yml", line: 4 },
    ]);
  });

  it("categorizes commands by intent", () => {
    expect(categorizeCommand("cargo test --workspace")).toBe("test");
    expect(categorizeCommand("npm run lint")).toBe("lint");
    expect(categorizeCommand("pnpm build")).toBe("build");
    expect(categorizeCommand("npm ci")).toBe("setup");
    expect(categorizeCommand("npm run dev")).toBe("run");
    expect(categorizeCommand("make deploy-prod")).toBe("other");
  });

  it("picks the package runner from lockfiles", () => {
    expect(packageRunner(["pnpm-lock.yaml"], "")).toBe("pnpm");
    expect(packageRunner(["yarn.lock"], "")).toBe("yarn");
    expect(packageRunner(["bun.lock"], "")).toBe("bun");
    expect(packageRunner([], "")).toBe("npm");
    expect(packageRunner(["web/pnpm-lock.yaml"], "web")).toBe("pnpm");
  });

  it("collects declared commands with sources, preferring CI evidence", () => {
    const commands = collectCommands({
      files: ["package.json", "pnpm-lock.yaml", "Makefile"],
      manifests: [
        {
          ecosystem: "npm",
          file: "package.json",
          dir: ".",
          scripts: [
            { name: "test", command: "vitest run", line: 4 },
            { name: "dev", command: "vite", line: 5 },
          ],
        },
      ],
      makeTargets: [{ name: "build", line: 2, file: "Makefile" }],
      justRecipes: [],
      ci: [{ command: "pnpm test", file: ".github/workflows/ci.yml", line: 9 }],
    });

    expect(commands).toEqual([
      {
        command: "pnpm test",
        category: "test",
        source: "ci",
        file: ".github/workflows/ci.yml",
        line: 9,
        cwd: ".",
      },
      {
        command: "pnpm run dev",
        category: "run",
        source: "script",
        file: "package.json",
        line: 5,
        cwd: ".",
        detail: "vite",
      },
      {
        command: "make build",
        category: "build",
        source: "make",
        file: "Makefile",
        line: 2,
        cwd: ".",
      },
    ]);
  });
});
