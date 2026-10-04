const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fg = require("fast-glob");
const {
  ciPortfolio,
  initPortfolio,
  scanPortfolio,
  verifyPortfolio,
} = require("./lib/portfolio-docs");
const { runPortfolioCommand } = require("./lib/portfolio-cli");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");

async function treeDigest(dir) {
  const files = await fg(["**/*"], { cwd: dir, dot: true, onlyFiles: true });
  const hash = crypto.createHash("sha256");
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(await fs.readFile(path.join(dir, file)));
  }
  return hash.digest("hex");
}

async function readOut(outDir, file) {
  return fs.readFile(path.join(outDir, file), "utf8");
}

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

describe("xfeat portfolio end to end", () => {
  const root = tempRoot("portfolio-docs");
  const outDir = path.join(root, "portfolio-out");
  let repos;

  beforeEach(async () => {
    repos = await createPortfolioFixture(path.join(root, "repos"));
    await fs.rm(outDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("writes routed pages and a model without modifying member repositories", async () => {
    const before = await Promise.all(repos.map(treeDigest));
    const result = await scanPortfolio({
      paths: repos,
      out: outDir,
      cwd: root,
    });
    const after = await Promise.all(repos.map(treeDigest));

    expect(after).toEqual(before);
    expect(result.documents).toEqual(
      expect.arrayContaining([
        "index.md",
        "getting-started.md",
        "landscape.md",
        "gaps.md",
        "dependencies.md",
        "packages.md",
        "decisions.md",
        "llms.txt",
        "portfolio.json",
        "diagrams/landscape.puml",
        "repos/billing-api.md",
        "repos/sync-worker.md",
        "integrations/billing-web--ui-kit.md",
        "integrations/billing-api--ledger.md",
      ]),
    );
    expect(result.edges).toBe(4);
    expect(result.ambiguous).toBe(1);
    expect(result.warnings).toEqual([
      expect.stringMatching(/sync-worker.*local files/),
    ]);
  });

  it("produces byte-identical output when repositories do not change", async () => {
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    const first = await treeDigest(outDir);
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });

    expect(await treeDigest(outDir)).toBe(first);
  });

  it("renders evidence links, labels, and gaps without leaking credentials", async () => {
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    const index = await readOut(outDir, "index.md");
    const api = await readOut(outDir, "repos/billing-api.md");
    const worker = await readOut(outDir, "repos/sync-worker.md");
    const integration = await readOut(
      outDir,
      "integrations/billing-web--ui-kit.md",
    );
    const gaps = await readOut(outDir, "gaps.md");
    const start = await readOut(outDir, "getting-started.md");
    const all = (await fg(["**/*"], { cwd: outDir })).map((f) => f);
    const corpus = (
      await Promise.all(all.map((file) => readOut(outDir, file)))
    ).join("\n");

    expect(corpus).not.toContain("s3cr3t");
    expect(corpus).not.toContain(root);
    expect(index.startsWith("---\ntype: landscape\n")).toBe(true);
    expect(index).toContain("| [billing-api](repos/billing-api.md) |");
    expect(index).toContain("group:payments");
    expect(index).toContain("none declared");
    expect(api).toMatch(
      /\[`billing-api:catalog-info.yaml:9`\]\(https:\/\/github\.com\/acme\/billing-api\/blob\/[0-9a-f]{40}\/catalog-info\.yaml#L9\)/,
    );
    expect(api).toContain("## Depends On");
    expect(api).not.toContain("## Maintainer Note");
    expect(worker).toContain("(../../repos/sync-worker/pyproject.toml#L3)");
    expect(worker).toContain("uncommitted-changes");
    expect(integration).toContain("Name match only");
    expect(integration).toContain("package-name");
    expect(gaps).toContain("## Ambiguous Package Names");
    expect(gaps).toContain("ledger, platform-workflows");
    expect(start.indexOf("ledger")).toBeLessThan(start.indexOf("## 4."));
    expect(start).toContain("git clone https://github.com/acme/ui-kit");
    const llms = await readOut(outDir, "llms.txt");
    expect(Buffer.byteLength(llms)).toBeLessThan(8192);
    expect(llms).toContain("- [billing-api](repos/billing-api.md)");
    expect(llms).not.toContain("Customer-facing billing portal");
    expect(api).toContain("| Entry point | `cmd/api/main.go` |");
    expect(
      await readOut(outDir, "integrations/billing-web--platform-workflows.md"),
    ).toContain("matched remote https://github.com/acme/platform-workflows");
    expect(index.split("\n").length).toBeLessThan(150);
    expect(index.indexOf("### billing")).toBeLessThan(
      index.indexOf("### Ungrouped"),
    );
    expect(await readOut(outDir, "landscape.md")).toContain(
      "| From | To | Kind | Confidence | Dependency | Details |",
    );
    const web = await readOut(outDir, "repos/billing-web.md");
    expect(web.indexOf("`pnpm run build`")).toBeLessThan(
      web.indexOf("`pnpm run dev`"),
    );
    expect(web).toContain(
      "| Status | active: last commit within 365 days of the newest commit in this portfolio |",
    );
    expect(web).toContain("`pnpm run seo:smoke`");
    expect(start).not.toContain("seo:smoke");
    const ledger = await readOut(outDir, "repos/ledger.md");
    expect(ledger).toContain("## Modules");
    expect(ledger).toContain("| Name | Ecosystem | Path | Role | Source |");
    expect(ledger).toContain("`bindings/cli/src/main.rs`");
    expect(ledger).not.toContain("| go package |");
    const dependencies = await readOut(outDir, "dependencies.md");
    expect(dependencies).toMatch(
      /`\^18\.2\.0`: \[billing-web\]\(https:\/\/github\.com/,
    );
  });

  it("verifies fresh output, warns on moved lines, and fails on changed or missing evidence", async () => {
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    expect((await verifyPortfolio({ out: outDir, cwd: root })).ok).toBe(true);

    const uiKitManifest = path.join(root, "repos", "ui-kit", "package.json");
    await fs.writeFile(
      uiKitManifest,
      `\n${await fs.readFile(uiKitManifest, "utf8")}`,
    );
    const moved = await verifyPortfolio({ out: outDir, cwd: root });
    expect(moved.ok).toBe(true);
    expect(moved.warnings.map((w) => w.type)).toContain("moved-evidence");

    const readme = path.join(root, "repos", "billing-web", "README.md");
    await fs.writeFile(readme, "# Billing Web\n\nRewritten purpose.\n");
    const changed = await verifyPortfolio({ out: outDir, cwd: root });
    expect(changed.ok).toBe(false);
    expect(changed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "changed-evidence",
          repo: "billing-web",
          file: "README.md",
        }),
      ]),
    );

    await fs.rm(path.join(root, "repos", "ledger"), { recursive: true });
    const missing = await verifyPortfolio({ out: outDir, cwd: root });
    expect(missing.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "missing-repo", repo: "ledger" }),
      ]),
    );
  });

  it("encodes link paths and reports undecodable links instead of crashing", async () => {
    const adr = path.join(repos[2], "docs", "adr", "0002 use queues.md");
    await fs.writeFile(adr, "# Use queues\n");
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    const decisions = await readOut(outDir, "decisions.md");
    expect(decisions).toContain("0002%20use%20queues.md");
    expect((await ciPortfolio({ out: outDir, cwd: root })).links.ok).toBe(true);

    await fs.appendFile(path.join(outDir, "gaps.md"), "\n[bad](bad%zz.md)\n");
    const result = await ciPortfolio({ out: outDir, cwd: root });
    expect(result.ok).toBe(false);
    expect(result.links.brokenLinks).toEqual([
      expect.objectContaining({ file: "gaps.md", target: "bad%zz.md" }),
    ]);
  });

  it("references the SVG only when plantuml actually rendered it", async () => {
    const bin = path.join(root, "fake-bin");
    await fs.mkdir(bin, { recursive: true });
    const fake = path.join(bin, "plantuml");
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    try {
      await fs.writeFile(
        fake,
        '#!/bin/sh\n[ "$1" = "-version" ] && exit 0\nexit 3\n',
        { mode: 0o755 },
      );
      const failed = await scanPortfolio({
        paths: repos,
        out: outDir,
        cwd: root,
        renderDiagrams: true,
      });
      expect(failed.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/failed to render/)]),
      );
      expect(await readOut(outDir, "landscape.md")).not.toContain(
        "landscape.svg",
      );

      await fs.writeFile(
        fake,
        '#!/bin/sh\n[ "$1" = "-version" ] && exit 0\nout="${2%.puml}.svg"\nprintf \'<svg style="background:#FFFFFF;"><defs/></svg>\' > "$out"\n',
        { mode: 0o755 },
      );
      const rendered = await scanPortfolio({
        paths: repos,
        out: outDir,
        cwd: root,
        renderDiagrams: true,
      });
      expect(rendered.documents).toContain("diagrams/landscape.svg");
      expect(await readOut(outDir, "landscape.md")).toContain(
        "![Landscape](diagrams/landscape.svg)",
      );
      expect(await readOut(outDir, "diagrams/landscape.svg")).toContain(
        "data-xfeat-white-canvas",
      );
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it("passes the CI gate with valid internal links", async () => {
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
    const result = await ciPortfolio({ out: outDir, cwd: root });

    expect(result.links.brokenLinks).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("fails verify when the portfolio manifest changes after a scan", async () => {
    const manifest = path.join(root, "xfeat.portfolio.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "Acme",
        output: "portfolio-out",
        repos: repos.map((repo) => ({ path: path.relative(root, repo) })),
      }),
    );
    await scanPortfolio({ manifest, cwd: root });
    expect((await verifyPortfolio({ manifest, cwd: root })).ok).toBe(true);

    const data = JSON.parse(await fs.readFile(manifest, "utf8"));
    data.repos[0].owner = "@acme/new-owner";
    await fs.writeFile(manifest, JSON.stringify(data));
    const result = await verifyPortfolio({ manifest, cwd: root });
    await fs.rm(manifest);

    expect(result.ok).toBe(false);
    expect(result.findings).toEqual([
      expect.objectContaining({ type: "changed-manifest" }),
    ]);
  });

  it("initializes a manifest from a parent folder and scans it by default", async () => {
    const init = await initPortfolio({
      from: path.join(root, "repos"),
      exclude: ["sync-*"],
      cwd: root,
      name: "Acme Billing",
      out: "portfolio-out",
    });
    const scan = await scanPortfolio({ cwd: root });

    expect(init).toMatchObject({ created: true, repos: 5 });
    expect(scan.outDir).toBe(await fs.realpath(outDir));
    expect(scan.repos).not.toContain("sync-worker");
    expect(await readOut(outDir, "index.md")).toContain("# Acme Billing");
    await fs.rm(path.join(root, "xfeat.portfolio.json"));
  });

  it("reports CLI errors and results as JSON", async () => {
    const lines = [];
    const bad = await runPortfolioCommand(["scan", "--bogus"], {
      stdout: (line) => lines.push(line),
      cwd: root,
    });
    expect(bad.exitCode).toBe(1);
    expect(JSON.parse(lines[0]).error).toBe("Unknown option --bogus");

    const cli = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "index.js"),
        "portfolio",
        "scan",
        ...repos,
        "--out",
        outDir,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout)).toMatchObject({
      command: "portfolio scan",
      exitCode: 0,
      edges: 4,
    });

    // Through a shell pipe, stdout is asynchronous on macOS; exiting early
    // used to truncate the JSON at the pipe buffer size.
    const quoted = [process.execPath, path.join(__dirname, "index.js")]
      .concat(["portfolio", "scan", ...repos, "--out", outDir])
      .map((arg) => `'${arg}'`)
      .join(" ");
    const piped = spawnSync("sh", ["-c", `${quoted} | cat`], {
      cwd: root,
      encoding: "utf8",
    });
    expect(piped.stdout.length).toBeGreaterThan(512);
    expect(JSON.parse(piped.stdout)).toMatchObject({
      command: "portfolio scan",
      exitCode: 0,
    });
  });
});
