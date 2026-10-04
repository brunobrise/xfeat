const path = require("path");
const fs = require("fs/promises");
const { scanPortfolio, verifyPortfolio } = require("./lib/portfolio-docs");
const {
  createPortfolioFixture,
  fixtureGit,
  tempRoot,
} = require("./test_files/portfolio-fixture");
const { longSentences } = require("./test_files/prose-lint");

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
  const readText = (file) => fs.readFile(path.join(outDir, file), "utf8");
  const readJson = async (file) => JSON.parse(await readText(file));

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

  it("reports malformed checks.json as a finding instead of crashing", async () => {
    await scan();
    for (const checks of [[null], [{ id: "owner:x", claims: "abc" }]]) {
      await fs.writeFile(
        path.join(outDir, "checks.json"),
        JSON.stringify({ checks }),
      );
      const verify = await verifyPortfolio({ out: outDir });
      expect(verify.ok).toBe(false);
      expect(verify.findings).toContainEqual({
        type: "invalid-checks",
        path: "checks.json",
      });
      expect(
        verify.findings.filter((f) => f.type === "check-claim-missing"),
      ).toEqual([]);
    }
  });

  it("names owner checks that rely on an edited portfolio manifest", async () => {
    const manifest = path.join(root, "xfeat.portfolio.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "Acme",
        output: "portfolio-out",
        repos: repos.map((repo) =>
          path.basename(repo) === "sync-worker"
            ? { path: "repos/sync-worker", owner: "@acme/data" }
            : { path: `repos/${path.basename(repo)}` },
        ),
      }),
    );
    await scanPortfolio({ manifest, cwd: root });
    const edited = JSON.parse(await fs.readFile(manifest, "utf8"));
    edited.repos.find((r) => r.owner).owner = "@acme/platform";
    await fs.writeFile(manifest, JSON.stringify(edited));
    const verify = await verifyPortfolio({ manifest, cwd: root });
    await fs.rm(manifest);
    expect(verify.findings).toContainEqual(
      expect.objectContaining({
        type: "changed-manifest",
        checks: ["owner:sync-worker"],
      }),
    );
  });

  it("writes an ordered learning path with at most three checks per step", async () => {
    const result = await scan();
    expect(result.documents).toContain("learn.md");
    const learn = await readText("learn.md");
    const headings = learn.match(/^## .+$/gm);
    expect(headings).toEqual([
      "## 1. Orient",
      "## 2. Run `billing-api`",
      "## 3. Trace `billing-api` to `ledger`",
      "## 4. Assess the impact of `ledger`",
      "## 5. Change `billing-api`",
    ]);
    for (const section of learn.split(/^## /m).slice(1)) {
      const checks = section.match(/<summary>Answer<\/summary>/g) || [];
      expect(checks.length).toBeLessThanOrEqual(3);
    }
    const run = learn.split(/^## /m)[2];
    expect(run).toContain("tests of `billing-api`");
    expect(run).not.toContain("tests of `billing-web`");
    const impact = learn.split(/^## /m)[4];
    expect(impact).not.toContain("change in `platform-workflows`");
    expect(learn).toContain("1. Clone `ledger`.");
    expect(learn).toContain("In `billing-api`, run `make test`.");
    expect(learn).toContain("integrations/billing-api--ledger.md");
    expect(learn).toMatch(/`sync-worker` → `ledger`/);
    expect(learn).toContain("Which file in `billing-api` declares");
    expect(learn).toMatch(/Source: \[`billing-api:catalog-info\.yaml:8`\]/);
  });

  it("keeps every learning path sentence at 25 words or fewer", async () => {
    await scan();
    expect(longSentences(await readText("learn.md"))).toEqual([]);
  });

  it("routes newcomers to the learning path from index.md and llms.txt", async () => {
    await scan();
    expect(await readText("index.md")).toContain("[Learning path](learn.md)");
    const llms = await readText("llms.txt");
    expect(llms).toContain("[learn](learn.md)");
    expect(llms).toContain("[checks.json](checks.json)");
  });

  it("omits trace and impact steps when no declared edges exist", async () => {
    const uiKit = repos.find((repo) => path.basename(repo) === "ui-kit");
    await scanPortfolio({ paths: [uiKit], out: outDir, cwd: root });
    const headings = (await readText("learn.md")).match(/^## .+$/gm);
    expect(headings).toEqual([
      "## 1. Orient",
      "## 2. Run `ui-kit`",
      "## 3. Change `ui-kit`",
    ]);
  });
});

describe("longSentences", () => {
  it("ignores code, links, tables, and headings", () => {
    const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(" ");
    expect(longSentences(`# ${long}\n\n| ${long} |\n`)).toEqual([]);
    expect(longSentences(`Run \`${long}\` now.`)).toEqual([]);
    expect(longSentences(`${long}.`)).toHaveLength(1);
  });
});
