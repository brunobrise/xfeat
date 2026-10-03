const path = require("path");
const fs = require("fs/promises");
const { collectRepoFacts } = require("./lib/portfolio-repo-facts");
const { createPortfolioFixture } = require("./test_files/portfolio-fixture");

describe("Portfolio repository facts", () => {
  const root = path.join(__dirname, "__portfolio_facts__");

  beforeAll(async () => {
    await createPortfolioFixture(root);
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const repo = (name) => ({
    name,
    slug: name,
    path: path.join(root, name),
    owner: "",
    system: "",
    lifecycle: "",
    notes: "",
    description: "",
    tags: [],
  });

  it("collects purpose, ownership, commands, and references for a web app", async () => {
    const facts = await collectRepoFacts(repo("billing-web"));

    expect(facts.git).toMatchObject({
      isRepo: true,
      branch: "main",
      remoteUrl: "https://github.com/acme/billing-web",
      dirty: false,
    });
    expect(facts.readme.summary).toBe(
      "Customer-facing billing portal where account owners review invoices and update payment methods.",
    );
    expect(facts.readme.evidence).toMatchObject({
      repo: "billing-web",
      file: "README.md",
      line: 3,
    });
    expect(facts.codeowners.owners).toEqual(["@acme/web-team"]);
    expect(facts.commands.map((c) => [c.command, c.source])).toEqual([
      ["pnpm install --frozen-lockfile", "ci"],
      ["pnpm test", "ci"],
      ["pnpm run dev", "script"],
      ["pnpm run build", "script"],
    ]);
    expect(facts.commands[1].evidence.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(facts.references.actions.map((a) => a.ref)).toEqual([
      "acme/platform-workflows",
      "actions/checkout",
    ]);
    expect(facts.languages[0]).toMatchObject({ name: "TypeScript", files: 2 });
    expect(facts.tests).toBe(1);
    expect(facts.tracked.has("package.json")).toBe(true);
  });

  it("collects catalog metadata, contracts, services, and ADRs for a Go service", async () => {
    const facts = await collectRepoFacts(repo("billing-api"));

    expect(facts.catalog.fields.owner.value).toBe("group:payments");
    expect(facts.catalog.fields.lifecycle.evidence.line).toBe(7);
    expect(facts.manifests[0]).toMatchObject({
      ecosystem: "go",
      name: "github.com/acme/billing-api",
    });
    expect(facts.contracts).toEqual([
      expect.objectContaining({
        kind: "protobuf",
        package: "billing.v1",
        file: "proto/billing/v1/invoice.proto",
      }),
    ]);
    expect(facts.services.map((s) => s.name)).toEqual(["api", "db"]);
    expect(facts.commands.map((c) => c.command)).toEqual([
      "make build",
      "make test",
    ]);
    expect(facts.adrs).toEqual(["docs/adr/0001-use-postgres.md"]);
    expect(facts.license.file).toBe("LICENSE");
    expect(facts.entrypoints).toEqual(["cmd/api/main.go"]);
  });

  it("detects README deprecation and Python CLIs, and flags dirty trees", async () => {
    const ledger = await collectRepoFacts(repo("ledger"));
    const worker = await collectRepoFacts(repo("sync-worker"));

    expect(ledger.readme.deprecation.evidence.line).toBe(3);
    expect(worker.git.dirty).toBe(true);
    expect(worker.git.remoteUrl).toBe("");
    expect(worker.readme).toBeNull();
    expect(worker.bins).toEqual([
      expect.objectContaining({ name: "acme-sync", target: "sync.cli:main" }),
    ]);
  });
});
