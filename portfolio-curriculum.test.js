const path = require("path");
const fs = require("fs/promises");
const { scanPortfolio, verifyPortfolio } = require("./lib/portfolio-docs");
const {
  createPortfolioFixture,
  fixtureGit,
  tempRoot,
} = require("./test_files/portfolio-fixture");

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

describe("xfeat portfolio checks and learning path", () => {
  const root = tempRoot("portfolio-curriculum");
  const outDir = path.join(root, "portfolio-out");
  let repos;

  beforeEach(async () => {
    repos = await createPortfolioFixture(path.join(root, "repos"));
    await fs.rm(outDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const scan = () => scanPortfolio({ paths: repos, out: outDir, cwd: root });
  const readJson = async (file) =>
    JSON.parse(await fs.readFile(path.join(outDir, file), "utf8"));

  it("writes checks.json that cites claims recorded in portfolio.json", async () => {
    const result = await scan();
    expect(result.documents).toContain("checks.json");
    expect(result.checks).toBeGreaterThan(0);
    const checks = await readJson("checks.json");
    const status = await readJson("portfolio.json");
    expect(checks).toMatchObject({
      schemaVersion: 1,
      generator: "xfeat portfolio",
      focus: "billing-api",
    });
    const claimIds = new Set(status.claims.map((claim) => claim.id));
    for (const check of checks.checks) {
      for (const id of check.claims) expect(claimIds.has(id)).toBe(true);
    }
  });

  it("is byte-identical across runs on unchanged repositories", async () => {
    await scan();
    const first = await fs.readFile(path.join(outDir, "checks.json"), "utf8");
    await scan();
    const second = await fs.readFile(path.join(outDir, "checks.json"), "utf8");
    expect(second).toBe(first);
  });

  it("names the checks affected by changed evidence", async () => {
    await scan();
    const goMod = path.join(root, "repos", "billing-api", "go.mod");
    const text = await fs.readFile(goMod, "utf8");
    await fs.writeFile(
      goMod,
      text.replace(
        "github.com/acme/ledger v0.4.0",
        "github.com/acme/ledger v0.5.0",
      ),
    );
    fixtureGit(path.dirname(goMod), ["commit", "-qam", "bump ledger"]);
    const verify = await verifyPortfolio({ out: outDir });
    expect(verify.ok).toBe(false);
    const finding = verify.findings.find(
      (item) =>
        item.type === "changed-evidence" &&
        item.claim ===
          "edge:billing-api->ledger:go-module:github.com/acme/ledger:consumer",
    );
    expect(finding.checks).toEqual(
      expect.arrayContaining([
        "dependencies:billing-api",
        "dependency-file:billing-api->ledger",
        "impact:ledger",
      ]),
    );
  });

  it("reports checks that cite unknown claims", async () => {
    await scan();
    const checks = await readJson("checks.json");
    checks.checks[0].claims.push("billing-api:owner:missing");
    await fs.writeFile(
      path.join(outDir, "checks.json"),
      `${JSON.stringify(checks, null, 2)}\n`,
    );
    const verify = await verifyPortfolio({ out: outDir });
    expect(verify.findings).toContainEqual({
      type: "check-claim-missing",
      check: checks.checks[0].id,
      claim: "billing-api:owner:missing",
    });
  });
});
