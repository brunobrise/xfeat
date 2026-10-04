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

  it("drops shell builtins and case arms from CI run blocks", () => {
    const commands = ciCommands(
      ".github/workflows/ci.yml",
      `jobs:
  test:
    steps:
      - run: |
          test -n "$identity" || { echo "no identity"; exit 1; }
          case "$digest" in
            sha256:*) ;;
            linux|darwin) npm run build ;;
            *) echo "Unexpected digest format: $digest"; exit 1 ;;
          esac
          local target=dist
          read -r version < VERSION
          shift
          trap cleanup EXIT
          eval "$setup"
          return 0
          test-runner --all
          npm test
`,
    );

    expect(commands.map((entry) => entry.command)).toEqual([
      "test-runner --all",
      "npm test",
    ]);
  });

  it("categorizes by command words, not redirection targets", () => {
    expect(
      categorizeCommand(
        "security set-key-partition-list -S apple-tool: -k pw kc >/dev/null",
      ),
    ).toBe("other");
    expect(categorizeCommand("codesign --verify app 2> /dev/null")).toBe(
      "other",
    );
    expect(categorizeCommand("npm run dev > dev.log 2>&1")).toBe("run");
  });

  it("categorizes check commands as lint, make check as test, cargo check as build", () => {
    expect(categorizeCommand("npm run check")).toBe("lint");
    expect(categorizeCommand("just check")).toBe("lint");
    expect(categorizeCommand("make check")).toBe("test");
    expect(categorizeCommand("/usr/bin/make -j4 check")).toBe("test");
    expect(categorizeCommand("make check-omlx-latest")).toBe("lint");
    expect(categorizeCommand("cargo check --workspace")).toBe("build");
  });

  it.each([
    // Arguments, flag values, quoted data, and later pipeline stages never count.
    ["bash scripts/install.sh --branch ci-under-test --commit $sha", "other"],
    ['docker tag "${IMAGE_NAME}:test" "${IMAGE_NAME}:latest"', "other"],
    ['docker image inspect "${IMAGE_NAME}:test" > /tmp/inspect.json', "other"],
    ["docker run --name test app", "other"],
    ["python -m scripts.ci.python_packages pytest==9.1.1 packaging", "other"],
    ["./deploy.sh test", "other"],
    ["npm ci && npm test", "setup"],
    ["DIFF_COUNT=$(find test-results -name '*-diff.png' | wc -l)", "other"],
    ["EXTRA_ARGS+=(--ignore-glob='*test_desktop_*.py')", "other"],
    ["(cd tests && pytest)", "other"],
    ["tool sync --format json", "other"],
    // The head names the intent.
    ["HERMES_TEST_WORKERS=$(nproc) scripts/run_tests.sh tests/docker/", "test"],
    ["bash scripts/run_tests.sh tests/scripts/test_install.py -q", "test"],
    [
      'xvfb-run -a --server-args="-screen 0 1280x1024x24" npx playwright test -c e2e',
      "test",
    ],
    ["python3 -m pytest -q", "test"],
    ["uv run pytest tests/unit", "test"],
    ["poetry run ruff check .", "lint"],
    ["python3 scripts/check-case-collisions.py", "lint"],
    ["node scripts/build.js", "build"],
    ["npx tauri build --target x86_64-pc-windows-msvc", "build"],
    ['bash -c "npm run lint -- --fix"', "lint"],
    ["npm --prefix web test", "test"],
    ["pnpm --filter web run test:unit", "test"],
    ["make -C services/api test", "test"],
    ["go mod download -x", "setup"],
    ["python -m pip install -e .", "setup"],
    ["cargo +nightly test --all", "test"],
    ["./gradlew test", "test"],
    ["/usr/local/bin/pytest -x", "test"],
    ["dist build --output-format=json", "build"],
    ["docker compose up -d", "other"],
    ["npm run dev > dev.log 2>&1", "run"],
    ["uvicorn app.main:app --reload", "run"],
    // Independent review: shells, script subcommands, prefixes, runners.
    ['bash -lc "npm test"', "test"],
    ["bash -ec 'make test'", "test"],
    ['bash -euo pipefail -c "pytest"', "test"],
    ['bash -c "echo \\"go\\" && pytest"', "test"],
    ['sh -c "cd web && npm test"', "test"],
    ["python manage.py test", "test"],
    ["python setup.py test", "test"],
    ["timeout 10m npm test", "test"],
    ["timeout -s KILL 600 go test ./...", "test"],
    ["nice -n 10 make test", "test"],
    ["env -u FOO make check", "test"],
    ["npm run -s test", "test"],
    ["npm run --workspaces --if-present test", "test"],
    ["pnpm run -r test", "test"],
    ["pnpm -r test", "test"],
    ["npm exec -- vitest run", "test"],
    ["uv run --python 3.12 pytest", "test"],
    ["nx affected -t test lint build", "test"],
    ["nx run-many --targets=build,test", "build"],
    ["yarn workspace @acme/web test", "test"],
    ["docker compose run --rm web pytest", "test"],
    ["docker compose exec -T web python manage.py test", "test"],
    ["docker exec -it api npm test", "test"],
    ["coverage run -m pytest", "test"],
    ["python -m coverage run -m pytest", "test"],
    ["node --require ts-node/register test/index.ts", "test"],
    ["bundle exec rspec", "test"],
    ["./gradlew check", "test"],
    ["make check-all", "lint"],
    ["yarn workspaces foreach -A --include '@acme/*' run test", "test"],
    ["docker run --rm --network host img pytest -d", "test"],
    ["docker run -d --name db -p 5432:5432 postgres:16 start", "other"],
    ["cmake --build build --target test", "test"],
    ["cmake --build out --config Release", "build"],
    ["ctest --output-on-failure", "test"],
    ["./vendor/bin/phpunit", "test"],
    ["node --test", "test"],
    // Stages: the first rule any `&&`/`||`/`;` stage matches wins; `|` filters.
    ["npm run build && xvfb-run -a npx playwright test", "test"],
    ["pytest || echo 'tests failed'", "test"],
    ["git ls-files | xargs pytest", "other"],
    [
      "powershell -NoProfile -ExecutionPolicy Bypass -File tests/install/windows-smoke.ps1",
      "test",
    ],
    ['pwsh -Command "npm test"', "test"],
    ["node --check tests/alpha/local-smoke.mjs", "lint"],
    ['python -c "import sys; print(sys.version)"', "other"],
    ["cargo build --target wasm32-unknown-unknown", "build"],
    // Corpus regressions: value flags between subcommands, `+` in script names.
    ["python3 -m unittest discover -s tests -p 'test_*.py'", "test"],
    ["docker compose -f swarm-config.yml build", "build"],
    ["npm run desktop:build+install:macos", "build"],
  ])("categorizes %s as %s", (command, category) => {
    expect(categorizeCommand(command)).toBe(category);
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

  it("drops release workflows, CI expressions, shell fragments, and tool installers", () => {
    const workflow = `jobs:
  build:
    steps:
      - run: |
          if ! command -v cargo > /dev/null 2>&1; then
            curl --proto '=https' -sSf https://sh.rustup.rs | sh -s -- -y
          fi
      - run: \${{ matrix.install_dist.run }}
      - run: dist build --output-format=json > "$GITHUB_OUTPUT"
      - run: chmod +x ~/.cargo/bin/dist
      - run: git config --global core.longpaths true
      - run: cargo test --workspace
`;

    expect(ciCommands(".github/workflows/ci.yml", workflow)).toEqual([
      {
        command: "cargo test --workspace",
        file: ".github/workflows/ci.yml",
        line: 12,
      },
    ]);
    expect(ciCommands(".github/workflows/release.yml", workflow)).toEqual([]);
    expect(ciCommands(".github/workflows/deploy-prod.yml", workflow)).toEqual(
      [],
    );
  });

  it("drops heredoc bodies, shell conditions, and bare assignments", () => {
    const workflow = `jobs:
  test:
    steps:
      - run: |
          FAILS=$(jq -r '.tests[] | .name' "$f" 2>/dev/null || echo "none")
          cat >> summary.md <<EOF
          **\${PASSED}/\${TOTAL}** tests passed
          npm test
          EOF
          test -f dist/app || (echo "MISSING: app" && exit 1)
          RESULT=ok
          BODY="## Evals

          **\${PASSED}/\${TOTAL}** tests passed
          npm test
          done"
          CI=true npm test
          bun run test
`;
    expect(
      ciCommands(".github/workflows/ci.yml", workflow).map((c) => c.command),
    ).toEqual(["CI=true npm test", "bun run test"]);
  });

  it("does not treat << inside a quoted string as a heredoc", () => {
    const workflow = `jobs:
  sync:
    steps:
      - run: |
          echo "log<<EOF" >> "$GITHUB_OUTPUT"
          echo "EOF" >> "$GITHUB_OUTPUT"
          python - << 'PY'
          import sys
          PY
          npm test
`;
    expect(
      ciCommands(".github/workflows/ci.yml", workflow).map((c) => c.command),
    ).toEqual(["python - << 'PY'", "npm test"]);
  });

  it("ignores flags when categorizing", () => {
    expect(categorizeCommand("dist build --output-format=json")).toBe("build");
    expect(categorizeCommand("tool sync --format json")).toBe("other");
  });
});
