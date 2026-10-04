const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { mkdtempSync, realpathSync } = require("fs");
const { execFileSync } = require("child_process");
const { hermeticGitEnv } = require("../lib/portfolio-git");

// Builds a realistic multi-repository selection with real git history:
// npm (pnpm) web app and UI kit, Go API and ledger with a shared protobuf
// contract, a reusable-workflow repository, and a Python worker.

function git(cwd, args, date) {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=xfeat-test",
      "-c",
      "user.email=xfeat@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      env: hermeticGitEnv(
        date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {},
      ),
    },
  );
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Refuses to stage or commit unless `dir` is its own repository root, so a
// failed `git init` can never add fixture files to an enclosing checkout.
function assertOwnRepository(dir) {
  const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    encoding: "utf8",
    env: hermeticGitEnv(),
  }).trim();
  if (realpathSync(top) !== realpathSync(dir)) {
    throw new Error(`Fixture ${dir} is not its own git repository (${top}).`);
  }
}

const REPOS = {
  "billing-web": {
    remote: "git@github.com:acme/billing-web.git",
    date: "2026-09-01T10:00:00+00:00",
    files: {
      "README.md":
        "# Billing Web\n\nCustomer-facing billing portal where account owners review\ninvoices and update payment methods.\n",
      "package.json": json({
        name: "@acme/billing-web",
        description: "Customer billing portal",
        license: "MIT",
        scripts: {
          dev: "vite",
          test: "vitest run",
          build: "vite build",
          "seo:smoke": "node scripts/seo-smoke.mjs",
        },
        dependencies: { "@acme/ui-kit": "^3.0.0", react: "^18.2.0" },
      }),
      "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      ".github/CODEOWNERS": "* @acme/web-team\n",
      ".github/workflows/ci.yml":
        "name: CI\non: [push]\njobs:\n  shared:\n    uses: acme/platform-workflows/.github/workflows/node.yml@v1\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm test\n",
      "src/main.ts": "export function mount() {\n  return 'billing';\n}\n",
      "src/main.test.ts": "test('mount', () => {});\n",
    },
  },
  "ui-kit": {
    remote: "https://deploy:s3cr3t-token@github.com/acme/ui-kit.git",
    date: "2026-08-20T10:00:00+00:00",
    files: {
      "README.md":
        "# UI Kit\n\nShared React components for Acme billing surfaces.\n",
      LICENSE: "MIT License\n",
      "package.json": json({
        name: "@acme/ui-kit",
        description: "Shared React components",
        scripts: { build: "tsup", test: "vitest run" },
        dependencies: { react: "^19.0.0" },
      }),
      "src/index.ts": "export const Button = () => null;\n",
    },
  },
  "billing-api": {
    remote: "git@github.com:acme/billing-api.git",
    date: "2026-08-25T10:00:00+00:00",
    files: {
      "README.md":
        "# Billing API\n\nGo service that issues invoices and records charges in the ledger.\n",
      LICENSE: "Apache License 2.0\n",
      "go.mod":
        "module github.com/acme/billing-api\n\ngo 1.22\n\nrequire (\n\tgithub.com/acme/ledger v0.4.0\n\tgithub.com/google/uuid v1.6.0\n)\n",
      "catalog-info.yaml":
        "apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: billing-api\nspec:\n  type: service\n  lifecycle: production\n  owner: group:payments\n  system: billing\n",
      Makefile: "build:\n\tgo build ./...\n\ntest:\n\tgo test ./...\n",
      Dockerfile: "FROM golang:1.22\n",
      "docker-compose.yml":
        "services:\n  api:\n    build: .\n  db:\n    image: postgres:16\n",
      "cmd/api/main.go": "package main\n\nfunc main() {}\n",
      "proto/billing/v1/invoice.proto":
        'syntax = "proto3";\n\npackage billing.v1;\n\nmessage Invoice {}\n',
      "docs/adr/0001-use-postgres.md": "# Use Postgres\n\nAccepted.\n",
    },
  },
  ledger: {
    remote: "git@github.com:acme/ledger.git",
    date: "2026-07-01T10:00:00+00:00",
    files: {
      "README.md":
        "# Ledger\n\n> This project is deprecated. Use the accounting service.\n\nDouble-entry ledger library for charge events.\n",
      "go.mod": "module github.com/acme/ledger\n\ngo 1.22\n",
      "pyproject.toml": '[project]\nname = "acme-common"\n',
      "proto/billing/v1/invoice.proto":
        'syntax = "proto3";\npackage billing.v1;\n',
      "ledger.go": "package ledger\n",
      "bindings/cli/Cargo.toml":
        '[package]\nname = "ledger-cli"\n\n[[bin]]\nname = "ledger"\npath = "src/main.rs"\n',
      "bindings/cli/src/main.rs": "fn main() {}\n",
    },
  },
  "platform-workflows": {
    remote: "git@github.com:acme/platform-workflows.git",
    date: "2024-01-15T10:00:00+00:00",
    files: {
      "README.md":
        "# Platform Workflows\n\nReusable GitHub Actions workflows.\n",
      "pyproject.toml": '[project]\nname = "acme_common"\n',
      ".github/workflows/node.yml":
        "on: workflow_call\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n",
    },
  },
  "sync-worker": {
    remote: "",
    date: "2026-06-10T10:00:00+00:00",
    dirty: { "notes.md": "draft\n" },
    files: {
      "pyproject.toml":
        '[project]\nname = "acme-sync"\ndescription = "Nightly invoice sync worker"\ndependencies = ["requests>=2", "acme-common==1.0"]\n\n[project.scripts]\nacme-sync = "sync.cli:main"\n',
      "requirements.txt": "-e ../ledger\n",
      "sync/__main__.py": "print('sync')\n",
      "tests/test_sync.py": "def test_sync():\n    pass\n",
    },
  },
};

async function createPortfolioFixture(root) {
  await fs.rm(root, { recursive: true, force: true });
  for (const [name, spec] of Object.entries(REPOS)) {
    const dir = path.join(root, name);
    for (const [file, body] of Object.entries(spec.files)) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), body);
    }
    git(dir, ["init", "-q", "-b", "main"]);
    assertOwnRepository(dir);
    if (spec.remote) git(dir, ["remote", "add", "origin", spec.remote]);
    git(dir, ["add", "."]);
    git(dir, ["commit", "-q", "-m", "initial import"], spec.date);
    for (const [file, body] of Object.entries(spec.dirty || {})) {
      await fs.writeFile(path.join(dir, file), body);
    }
  }
  return Object.keys(REPOS).map((name) => path.join(root, name));
}

// A unique, real (symlink-resolved) temporary folder per test file, so
// concurrent test runs in one checkout never share fixture state.
function tempRoot(name) {
  return realpathSync(mkdtempSync(path.join(os.tmpdir(), `xfeat-${name}-`)));
}

module.exports = { createPortfolioFixture, fixtureGit: git, tempRoot };
