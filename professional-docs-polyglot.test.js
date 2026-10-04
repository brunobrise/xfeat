const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const {
  runProfessionalCommand,
  scanProfessionalDocs,
} = require("./lib/professional-docs");

const RUST_WORKSPACE = {
  "Cargo.toml": [
    "[workspace]",
    'resolver = "2"',
    "members = [",
    '    "crates/*",',
    "]",
    'exclude = ["crates/scratch"]',
    "",
    "[workspace.dependencies]",
    'serde = "1"',
    'ledger-core = { path = "crates/ledger-core" }',
    "",
  ].join("\n"),
  "crates/ledger-core/Cargo.toml": [
    "[package]",
    'name = "ledger-core"',
    'version = "0.1.0"',
    'description = "Double-entry ledger primitives for account balances"',
    "",
    "[dependencies]",
    "serde = { workspace = true }",
    "",
  ].join("\n"),
  "crates/ledger-core/src/lib.rs": [
    "pub mod accounts;",
    "",
    "pub struct Ledger;",
    "",
    "pub enum EntryKind { Debit, Credit }",
    "",
    "pub fn post_entry(ledger: &mut Ledger) {}",
    "",
    "pub(crate) fn rebuild_index() {}",
    "",
    "fn validate() {}",
    "",
  ].join("\n"),
  "crates/scratch/Cargo.toml":
    '[package]\nname = "scratch"\nversion = "0.1.0"\n',
  "crates/scratch/src/lib.rs": "pub fn experiment() {}\n",
  "crates/ledger-core/src/accounts.rs": "pub struct Account { pub id: u64 }\n",
  "crates/ledger-cli/Cargo.toml": [
    "[package]",
    'name = "ledger-cli"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[[bin]]",
    'name = "ledger"',
    'path = "src/main.rs"',
    "",
    "[dependencies]",
    "ledger-core.workspace = true",
    "",
  ].join("\n"),
  "crates/ledger-cli/src/main.rs":
    "use ledger_core::post_entry;\n\nfn main() {}\n",
  "sidecar/package.json": JSON.stringify(
    {
      name: "ledger-sidecar",
      description: "Webhook relay for ledger events",
      main: "index.js",
      scripts: { start: "node index.js" },
    },
    null,
    2,
  ),
  "sidecar/index.js": "export function relay(event) {\n  return event;\n}\n",
  "scripts/release.sh": "#!/bin/sh\ncargo build --release\n",
  "target/debug/incremental/bindings.rs": "pub fn generated_binding() {}\n",
  "README.md": [
    "# Ledger Workspace",
    "",
    "Ledger Workspace records double-entry accounting events for finance",
    "teams and exposes them through a command-line interface. Balances stay",
    "consistent across every service that posts entries.",
    "",
    "## Usage",
    "",
    "Run the CLI.",
    "",
  ].join("\n"),
};

const PYTHON_PROJECT = {
  "pyproject.toml": [
    "[project]",
    'name = "billing-api"',
    'description = "HTTP API for invoice creation and payment status"',
    'dependencies = ["fastapi>=0.110"]',
    "",
  ].join("\n"),
  "src/billing_api/__init__.py":
    'from .invoices import create_invoice\n\n__all__ = ["create_invoice"]\n',
  "src/billing_api/invoices.py": [
    "MAX_LINES = 50",
    "",
    "class Invoice:",
    "    pass",
    "",
    "def create_invoice():",
    "    return Invoice()",
    "",
    "def _round(value):",
    "    return value",
    "",
  ].join("\n"),
  "tests/test_invoices.py": "def test_create():\n    pass\n",
  "README.md":
    "# Billing API\n\nCreates invoices and reports payment status for the billing portal\n",
};

const GO_MODULE = {
  "go.mod": [
    "module github.com/acme/payments",
    "",
    "go 1.22",
    "",
    "require github.com/stripe/stripe-go/v76 v76.0.0",
    "",
  ].join("\n"),
  "payments.go": [
    "package payments",
    "",
    "type Gateway struct{}",
    "",
    "func Charge(amount int) error { return nil }",
    "",
    "func refund() {}",
    "",
    "func (g *Gateway) Authorize() bool { return true }",
    "",
  ].join("\n"),
  "payments_test.go":
    'package payments\n\nimport "testing"\n\nfunc TestCharge(t *testing.T) {}\n',
};

async function writeTree(root, files) {
  for (const [file, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), body);
  }
}

const read = (root, file) => fs.readFile(path.join(root, file), "utf8");

describe("Professional docs scan on polyglot repositories", () => {
  let workspace;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "xfeat-polyglot-"));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("documents a Cargo workspace with one component per member crate", async () => {
    await writeTree(workspace, RUST_WORKSPACE);

    const scan = await scanProfessionalDocs(workspace);
    const overview = await read(workspace, "docs/architecture/overview.md");
    const core = await read(workspace, "docs/components/ledger-core.md");
    const cli = await read(workspace, "docs/components/ledger-cli.md");
    const onboarding = await read(workspace, "docs/onboarding.md");
    const imports = await read(workspace, "docs/reference/import-graph.md");

    expect(scan.semantic.components).toEqual([
      "ledger-cli",
      "ledger-core",
      "ledger-sidecar",
      "scratch",
      "scripts",
    ]);
    expect(scan.documents).not.toContain("docs/components/crates.md");
    expect(overview).not.toContain("No package metadata detected");
    expect(overview).toContain(
      "`Cargo.toml` declares a Cargo workspace with 2 members: ledger-cli, ledger-core. Evidence: [`Cargo.toml:3`]",
    );
    expect(overview).toContain(
      "| ledger-core | Double-entry ledger primitives for account balances | 2 | 5 |",
    );
    expect(overview).toContain(
      "- ledger-cli declares a package dependency on ledger-core. Evidence: [`crates/ledger-cli/Cargo.toml:11`]",
    );
    expect(imports).not.toMatch(/^\| root \|/m);
    expect(core).toContain("# Component: ledger-core");
    expect(core).toContain(
      "| `Ledger` | struct | [`crates/ledger-core/src/lib.rs:3`]",
    );
    for (const name of ["accounts", "EntryKind", "post_entry", "Account"]) {
      expect(core).toContain(`| \`${name}\` |`);
    }
    expect(core).not.toContain("rebuild_index`");
    expect(core).not.toContain("`validate`");
    expect(core).toContain(
      "| `crates/ledger-core/src/lib.rs` | package source entrypoint |",
    );
    expect(core).toContain(
      "- Owns Double-entry ledger primitives for account balances. Evidence: [`crates/ledger-core/Cargo.toml:4`]",
    );
    expect(cli).toContain(
      "- Owns the `ledger-cli` package under `crates/ledger-cli`; its manifest declares no description. Evidence: [`crates/ledger-cli/Cargo.toml:2`]",
    );
    expect(onboarding).not.toContain("npm install");
    expect(onboarding).toContain("`Cargo.toml:");
  });

  it("joins wrapped README lines into one summary and cites the paragraph", async () => {
    await writeTree(workspace, RUST_WORKSPACE);

    await scanProfessionalDocs(workspace);
    const overview = await read(workspace, "docs/architecture/overview.md");

    expect(overview).toContain(
      "- Ledger Workspace: Ledger Workspace records double-entry accounting events for finance teams and exposes them through a command-line interface. Balances stay consistent across every service that posts entries. Evidence: [`README.md:3`]",
    );
  });

  it("documents Python package metadata and module-level public names", async () => {
    await writeTree(workspace, PYTHON_PROJECT);

    const scan = await scanProfessionalDocs(workspace);
    const overview = await read(workspace, "docs/architecture/overview.md");
    const component = await read(workspace, "docs/components/billing-api.md");

    expect(scan.semantic.components).toEqual(["billing-api"]);
    expect(overview).toContain(
      "- Package metadata identifies this repository as `billing-api` (Python). Evidence: [`pyproject.toml:2`]",
    );
    expect(overview).toContain(
      "- Billing API: Creates invoices and reports payment status for the billing portal. Evidence: [`README.md:3`]",
    );
    for (const name of ["create_invoice", "Invoice", "MAX_LINES"]) {
      expect(component).toContain(`| \`${name}\` |`);
    }
    expect(component).not.toContain("`_round`");
    expect(component).not.toContain("`test_create`");
    expect(component).toContain(
      "| `src/billing_api/__init__.py` | package source entrypoint |",
    );
  });

  it("documents Go module metadata and exported identifiers", async () => {
    await writeTree(workspace, GO_MODULE);

    const scan = await scanProfessionalDocs(workspace);
    const overview = await read(workspace, "docs/architecture/overview.md");
    const component = await read(
      workspace,
      "docs/components/github-com-acme-payments.md",
    );

    expect(scan.semantic.components).toEqual(["github.com/acme/payments"]);
    expect(overview).toContain(
      "- Package metadata identifies this repository as `github.com/acme/payments` (Go). Evidence: [`go.mod:1`]",
    );
    for (const name of ["Gateway", "Charge", "Authorize"]) {
      expect(component).toContain(`| \`${name}\` |`);
    }
    expect(component).not.toContain("`refund`");
    expect(component).not.toContain("`TestCharge`");
  });

  it("keeps same-named packages apart and skips manifests without source", async () => {
    await writeTree(workspace, {
      "services/api/requirements.txt": "flask==3.0\n",
      "services/api/app.py": "def handler():\n    pass\n",
      "tools/api/requirements.txt": "click==8.1\n",
      "tools/api/run.py": "def main():\n    pass\n",
      "docs/requirements.txt": "mkdocs==1.6\n",
      "web/package.json": JSON.stringify({ name: "billing" }),
      "web/index.js": "export function mount() {}\n",
      "core/Cargo.toml": '[package]\nname = "billing"\nversion = "0.1.0"\n',
      "core/src/lib.rs": "pub fn charge() {}\n",
    });

    const scan = await scanProfessionalDocs(workspace);

    expect(scan.semantic.components).toEqual([
      "billing (core)",
      "billing (web)",
      "services/api",
      "tools/api",
    ]);
    expect(scan.documents).toEqual(
      expect.arrayContaining([
        "docs/components/billing-core.md",
        "docs/components/billing-web.md",
        "docs/components/services-api.md",
        "docs/components/tools-api.md",
      ]),
    );
    expect(scan.documents).not.toContain("docs/components/docs.md");
  });

  it("keeps fresh docs audit-clean when package names contain underscores", async () => {
    await writeTree(workspace, {
      "Cargo.toml": '[package]\nname = "ledger_tools"\nversion = "0.1.0"\n',
      "src/main.rs": "fn main() {}\n",
    });

    await scanProfessionalDocs(workspace);
    const ci = await runProfessionalCommand(["ci", workspace], {
      stdout: () => {},
      stderr: () => {},
    });

    expect(ci.audit.staleReferences).toEqual([]);
    expect(ci.exitCode).toBe(0);
  });

  it("reports missing package metadata only when no manifest exists", async () => {
    await writeTree(workspace, {
      "tools/cleanup.sh": "#!/bin/sh\nrm -rf tmp\n",
    });

    await scanProfessionalDocs(workspace);
    const overview = await read(workspace, "docs/architecture/overview.md");

    expect(overview).toContain("- No package metadata detected.");
  });
});
