const path = require("path");
const fs = require("fs/promises");
const { buildPortfolioModel, cloneOrder } = require("./lib/portfolio-model");
const { loadPortfolioSelection } = require("./lib/portfolio-selection");
const { createPortfolioFixture } = require("./test_files/portfolio-fixture");

describe("Portfolio model", () => {
  const root = path.join(__dirname, "__portfolio_model__");
  let model;

  beforeAll(async () => {
    const dirs = await createPortfolioFixture(root);
    const manifest = path.join(root, "xfeat.portfolio.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "Acme Billing",
        repos: [...dirs.map((dir) => ({ path: path.basename(dir) }))].map(
          (repo) =>
            repo.path === "sync-worker"
              ? { ...repo, owner: "@acme/data", system: "billing" }
              : repo,
        ),
      }),
    );
    model = await buildPortfolioModel(
      await loadPortfolioSelection({ manifest }),
    );
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repo = (slug) => model.repos.find((item) => item.slug === slug);

  it("resolves ownership with manifest, catalog, and CODEOWNERS precedence", () => {
    expect(repo("sync-worker").ownership).toEqual({
      value: "@acme/data",
      label: "manifest",
      evidence: null,
    });
    expect(repo("billing-api").ownership).toMatchObject({
      value: "group:payments",
      label: "source",
    });
    expect(repo("billing-web").ownership.value).toBe("@acme/web-team");
    expect(repo("ui-kit").ownership).toBeNull();
  });

  it("derives lifecycle status deterministically from the selection", () => {
    expect(repo("billing-api").status).toMatchObject({
      value: "production",
      label: "source",
    });
    expect(repo("ledger").status.value).toBe("deprecated");
    expect(repo("platform-workflows").status).toMatchObject({
      value: "dormant",
      label: "derived",
    });
    expect(repo("billing-web").status.value).toBe("active");
  });

  it("reports gaps and coverage without inventing missing facts", () => {
    const codes = (slug) => repo(slug).gaps.map((gap) => gap.code);

    expect(codes("ui-kit")).toEqual(["no-owner", "no-ci"]);
    expect(codes("sync-worker")).toEqual(
      expect.arrayContaining([
        "no-test-command",
        "no-ci",
        "no-license",
        "uncommitted-changes",
      ]),
    );
    expect(model.coverage.owner).toEqual({ count: 3, total: 6 });
    expect(codes("sync-worker")).not.toContain("no-purpose");
    expect(repo("sync-worker").purpose).toMatchObject({
      value: "Nightly invoice sync worker",
      label: "source",
      evidence: expect.objectContaining({ file: "pyproject.toml", line: 3 }),
    });
  });

  it("orders clones so providers come before consumers", () => {
    const order = model.cloneOrder.map((item) => item.slug);
    expect(order.indexOf("ledger")).toBeLessThan(order.indexOf("billing-api"));
    expect(order.indexOf("ui-kit")).toBeLessThan(order.indexOf("billing-web"));
    expect(
      cloneOrder(
        [{ slug: "a" }, { slug: "b" }],
        [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      ),
    ).toEqual([
      { slug: "a", cycle: true },
      { slug: "b", cycle: false },
    ]);
  });

  it("emits claims with line hashes for every cited fact", () => {
    expect(model.claims.length).toBeGreaterThan(20);
    expect(
      model.claims.every((claim) => /^[0-9a-f]{16}$/.test(claim.evidence.hash)),
    ).toBe(true);
    expect(model.claims.map((claim) => claim.id)).toEqual(
      expect.arrayContaining([
        "billing-web:purpose:readme",
        "billing-api:owner:default",
        "edge:billing-web->ui-kit:package-name:@acme/ui-kit:provider",
      ]),
    );
    expect(new Set(model.claims.map((c) => c.id)).size).toBe(
      model.claims.length,
    );
  });
});
