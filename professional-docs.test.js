const path = require("path");
const fs = require("fs/promises");
const { spawnSync } = require("child_process");
const {
  initProfessionalDocs,
  scanProfessionalDocs,
  auditProfessionalDocs,
  verifyProfessionalDocs,
  runProfessionalCommand,
} = require("./lib/professional-docs");

describe("Professional documentation workflow", () => {
  const workspace = path.join(__dirname, "__professional_docs_workspace__");

  beforeEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(path.join(workspace, "src"), { recursive: true });
    await fs.mkdir(path.join(workspace, "scripts"), { recursive: true });
    await fs.mkdir(path.join(workspace, "packages", "billing", "src"), {
      recursive: true,
    });
    await fs.mkdir(path.join(workspace, "packages", "ledger", "src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify(
        {
          name: "billing-workspace",
          description: "Billing automation workspace",
          workspaces: ["packages/*"],
          scripts: {
            build: "node scripts/build.js",
            test: "jest --runInBand",
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(workspace, "src", "billing.js"),
      `
      import currency from "currency.js";

      export class BillingService {
        chargeCustomer(customerId, amount) {
          return currency(amount).value + customerId.length;
        }
      }

      export function buildInvoice(id) {
        return { id, status: "draft" };
      }
      `,
    );
    await fs.writeFile(
      path.join(workspace, "scripts", "build.js"),
      "console.log('build billing workspace');\n",
    );
    await fs.writeFile(
      path.join(workspace, "packages", "billing", "package.json"),
      JSON.stringify(
        {
          name: "@acme/billing",
          description: "Billing package for account charges and invoices",
          main: "src/index.js",
          exports: {
            ".": "./src/index.js",
          },
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(workspace, "packages", "billing", "src", "index.js"),
      `
      import { createLedger } from "../../ledger/src/index.js";
      export { BillingService, buildInvoice } from "../../../src/billing.js";

      export function chargeWithLedger(customerId, amount) {
        const ledger = createLedger();
        return ledger.record(customerId, amount);
      }
      `,
    );
    await fs.writeFile(
      path.join(workspace, "packages", "ledger", "package.json"),
      JSON.stringify(
        {
          name: "@acme/ledger",
          description: "Ledger package for recording charge events",
          main: "src/index.js",
        },
        null,
        2,
      ),
    );
    await fs.writeFile(
      path.join(workspace, "packages", "ledger", "src", "index.js"),
      `
      export function createLedger() {
        return {
          record(customerId, amount) {
            return { customerId, amount, status: "recorded" };
          },
        };
      }
      `,
    );
    await fs.writeFile(
      path.join(workspace, "README.md"),
      "# Billing Workspace\n\n---\n\nUse `BillingService` to charge accounts.\n",
    );
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("initializes documentation policy without overwriting existing config", async () => {
    const first = await initProfessionalDocs(workspace);
    const second = await initProfessionalDocs(workspace);

    expect(first.createdConfig).toBe(true);
    expect(second.createdConfig).toBe(false);
    await expect(
      fs.stat(path.join(workspace, ".xfeat.yml")),
    ).resolves.toBeTruthy();
    await expect(fs.stat(path.join(workspace, "docs"))).resolves.toBeTruthy();
  });

  it("scans source files into grounded docs and verifies the generated status", async () => {
    const scan = await scanProfessionalDocs(workspace);
    const status = JSON.parse(
      await fs.readFile(path.join(workspace, ".xfeat", "status.json"), "utf8"),
    );
    const overview = await fs.readFile(
      path.join(workspace, "docs", "architecture", "overview.md"),
      "utf8",
    );
    const verify = await verifyProfessionalDocs(workspace);

    expect(scan.claims.length).toBeGreaterThanOrEqual(2);
    expect(status.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "src/billing.js",
          line: expect.any(Number),
        }),
      ]),
    );
    expect(overview).toContain("BillingService");
    expect(verify.ok).toBe(true);
  });

  it("generates semantic Diataxis docs from metadata, symbols, imports, and scripts", async () => {
    await scanProfessionalDocs(workspace);

    const status = JSON.parse(
      await fs.readFile(path.join(workspace, ".xfeat", "status.json"), "utf8"),
    );
    const overview = await fs.readFile(
      path.join(workspace, "docs", "architecture", "overview.md"),
      "utf8",
    );
    const component = await fs.readFile(
      path.join(workspace, "docs", "components", "acme-billing.md"),
      "utf8",
    );
    const onboarding = await fs.readFile(
      path.join(workspace, "docs", "onboarding.md"),
      "utf8",
    );
    const buildHowTo = await fs.readFile(
      path.join(workspace, "docs", "how-to", "build.md"),
      "utf8",
    );
    const testHowTo = await fs.readFile(
      path.join(workspace, "docs", "how-to", "test.md"),
      "utf8",
    );

    expect(status.documents).toEqual(
      expect.arrayContaining([
        "docs/how-to/build.md",
        "docs/how-to/test.md",
        "docs/components/acme-billing.md",
      ]),
    );
    expect(overview).toContain("Billing Workspace");
    expect(overview).toContain("Use `BillingService` to charge accounts.");
    expect(overview).toContain("Billing automation workspace");
    expect(overview).toContain("## Runtime Flow");
    expect(overview).toContain("packages/billing/src/index.js");
    expect(overview).toContain("packages/ledger/src/index.js");
    expect(component).toContain("# Component: @acme/billing");
    expect(component).toContain("## Responsibilities");
    expect(component).toContain("Billing package for account charges");
    expect(component).toContain("## Public APIs");
    expect(component).toContain("chargeWithLedger");
    expect(component).toContain("## Important Files");
    expect(component).toContain("## Data Flow");
    expect(component).toContain("## Source Excerpts");
    expect(component).toContain("`packages/billing/package.json:");
    expect(onboarding).toContain("# Onboarding");
    expect(onboarding).toContain("npm install");
    expect(onboarding).toContain("npm run build");
    expect(onboarding).toContain("packages/billing/src/index.js");
    expect(buildHowTo).toContain("# How To Build");
    expect(buildHowTo).toContain("npm run build");
    expect(buildHowTo).toContain("`package.json:");
    expect(testHowTo).toContain("# How To Test");
    expect(testHowTo).toContain("npm run test");
    expect(testHowTo).toContain("`package.json:");
  });

  it("generates complete reference docs without truncating evidence", async () => {
    await fs.writeFile(
      path.join(workspace, "packages", "billing", "src", "many-exports.js"),
      Array.from(
        { length: 90 },
        (_, index) =>
          `export function billingExport${index}() { return ${index}; }`,
      ).join("\n"),
    );
    await fs.writeFile(
      path.join(workspace, "src", "billing.test.js"),
      "import { buildInvoice } from './billing.js';\ntest('invoice', () => buildInvoice('1'));\n",
    );

    const scan = await scanProfessionalDocs(workspace);
    const status = JSON.parse(
      await fs.readFile(path.join(workspace, ".xfeat", "status.json"), "utf8"),
    );
    const component = await fs.readFile(
      path.join(workspace, "docs", "components", "acme-billing.md"),
      "utf8",
    );
    const claims = await fs.readFile(
      path.join(workspace, "docs", "reference", "claims.md"),
      "utf8",
    );
    const symbols = await fs.readFile(
      path.join(workspace, "docs", "reference", "symbols.md"),
      "utf8",
    );
    const files = await fs.readFile(
      path.join(workspace, "docs", "reference", "files.md"),
      "utf8",
    );
    const imports = await fs.readFile(
      path.join(workspace, "docs", "reference", "import-graph.md"),
      "utf8",
    );
    const testHowTo = await fs.readFile(
      path.join(workspace, "docs", "how-to", "test.md"),
      "utf8",
    );

    expect(status.documents).toEqual(
      expect.arrayContaining([
        "docs/reference/claims.md",
        "docs/reference/files.md",
        "docs/reference/import-graph.md",
        "docs/reference/symbols.md",
      ]),
    );
    expect(component).toContain("billingExport89");
    expect(component).not.toContain("additional exported symbols omitted");
    expect(claims).toContain("billingExport89 is a function");
    expect(symbols).toContain("billingExport89");
    expect(files).toContain("packages/billing/src/many-exports.js");
    expect(imports).toContain("packages/billing/src/index.js");
    expect(imports).toContain("packages/ledger/src/index.js");
    expect(testHowTo).toContain("src/billing.test.js");
    expect((claims.match(/\| /g) || []).length).toBeGreaterThan(
      scan.claims.length,
    );
  });

  it("audits stale code references and broken relative markdown links", async () => {
    await scanProfessionalDocs(workspace);
    await fs.writeFile(
      path.join(workspace, "docs", "manual.md"),
      "This page mentions `RemovedBillingAdapter` and links to [missing](./missing.md).\n",
    );

    const audit = await auditProfessionalDocs(workspace, { changedOnly: true });

    expect(audit.changedOnly).toBe(true);
    expect(audit.staleReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "RemovedBillingAdapter" }),
      ]),
    );
    expect(audit.brokenLinks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: "./missing.md" }),
      ]),
    );
  });

  it("returns nonzero CI result when audit findings are blocking", async () => {
    await scanProfessionalDocs(workspace);
    await fs.writeFile(
      path.join(workspace, "docs", "manual.md"),
      "Stale implementation note: `RemovedBillingAdapter`.\n",
    );

    const result = await runProfessionalCommand(["ci", workspace], {
      stdout: () => {},
      stderr: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.audit.staleReferences).toHaveLength(1);
  });

  it("prints machine-readable JSON from the CLI without dotenv banners", async () => {
    await scanProfessionalDocs(workspace);

    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "index.js"), "verify", workspace],
      {
        cwd: __dirname,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });
});
