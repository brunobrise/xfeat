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
      path.join(workspace, "README.md"),
      "# Billing Workspace\n\nUse `BillingService` to charge accounts.\n",
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
    expect(status.claims[0]).toEqual(
      expect.objectContaining({
        file: "src/billing.js",
        line: expect.any(Number),
      }),
    );
    expect(overview).toContain("BillingService");
    expect(verify.ok).toBe(true);
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
