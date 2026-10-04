const path = require("path");
const fs = require("fs/promises");
const fg = require("fast-glob");
const { scanPortfolio } = require("./lib/portfolio-docs");
const { scanProfessionalDocs } = require("./lib/professional-docs");
const {
  createPortfolioFixture,
  fixtureGit,
  tempRoot,
} = require("./test_files/portfolio-fixture");
const { proseFindings } = require("./test_files/prose-lint");

// These suites create real repositories; allow for slow CI runners.
jest.setTimeout(120000);

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// Passive sentences whose doer is unknown, as rule 3.6 allows. Each entry
// says why the doer cannot be named. Empty: every template names its doer.
const ALLOWED_PASSIVES = [];

async function writeRepo(dir, files, { git = true, remote = "" } = {}) {
  for (const [file, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), body);
  }
  if (git) {
    fixtureGit(dir, ["init", "-q", "-b", "main"]);
    if (remote) fixtureGit(dir, ["remote", "add", "origin", remote]);
    fixtureGit(dir, ["add", "."]);
    fixtureGit(
      dir,
      ["commit", "-q", "-m", "init"],
      "2026-09-01T10:00:00+00:00",
    );
  }
  return dir;
}

// llms.txt keeps its summary in a blockquote, as the llms.txt format asks,
// but that summary is xfeat's own text, so it is checked too.
async function findingsIn(dir, files) {
  const out = [];
  for (const file of files) {
    let text = await fs.readFile(path.join(dir, file), "utf8");
    if (file.endsWith("llms.txt")) text = text.replace(/^> /gm, "");
    for (const finding of proseFindings(text, { allow: ALLOWED_PASSIVES })) {
      out.push({ file, ...finding });
    }
  }
  return out;
}

async function portfolioPages(result) {
  return result.documents.filter(
    (doc) => doc.endsWith(".md") || doc.endsWith("llms.txt"),
  );
}

// Only pages xfeat wrote, marked as generated; a repository's own docs
// belong to its authors.
async function scanPages(dir) {
  const pages = [];
  for (const page of await fg(["docs/**/*.md", "xfeat-report.md"], {
    cwd: dir,
  })) {
    const text = await fs.readFile(path.join(dir, page), "utf8");
    if (text.startsWith("<!-- xfeat:generated")) pages.push(page);
  }
  return pages;
}

describe("pages xfeat portfolio scan writes follow the STE-lite rules", () => {
  const root = tempRoot("prose-portfolio");

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("checks the shared fixture with owners and multi-line notes", async () => {
    const repos = await createPortfolioFixture(path.join(root, "fixture"));
    const manifest = path.join(root, "fixture.portfolio.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "Acme Billing",
        description:
          "Billing systems for the finance group; owned by platform. It's maintained weekly.",
        output: "fixture-out",
        repos: repos.map((repo) =>
          path.basename(repo) === "sync-worker"
            ? {
                path: "fixture/sync-worker",
                owner: "@acme/data",
                notes:
                  "Runs nightly; ask the data team. It's fragile.\n- Do not | pipe\n```",
              }
            : { path: `fixture/${path.basename(repo)}` },
        ),
      }),
    );
    const result = await scanPortfolio({ manifest, cwd: root });
    const pages = await portfolioPages(result);
    expect(pages).toContain("llms.txt");
    expect(await findingsIn(path.join(root, "fixture-out"), pages)).toEqual([]);
  });

  it("checks cycles, broken and oversized manifests, and folders without git", async () => {
    const dir = path.join(root, "edge");
    await writeRepo(
      path.join(dir, "alpha"),
      {
        "README.md": "# Alpha\n\nAlpha service that bills customers.\n",
        "package.json": json({
          name: "@x/alpha",
          scripts: { test: "jest" },
          dependencies: { "@x/beta": "1" },
        }),
      },
      { remote: "git@github.com:x/alpha.git" },
    );
    await writeRepo(
      path.join(dir, "beta"),
      {
        "README.md": "## Deprecated\n\nBeta formats invoices for print.\n",
        "package.json": json({
          name: "@x/beta",
          dependencies: { "@x/alpha": "1" },
        }),
      },
      { remote: "git@github.com:x/beta.git" },
    );
    await writeRepo(
      path.join(dir, "gamma"),
      { "package.json": "{ broken json" },
      { git: false },
    );
    await writeRepo(path.join(dir, "delta"), {
      "README.md": "# Delta\n\nDelta has a very large manifest.\n",
      "package.json": json({
        name: "@x/delta",
        description: "x".repeat(1100000),
      }),
    });
    const out = path.join(root, "edge-out");
    const result = await scanPortfolio({
      paths: ["alpha", "beta", "gamma", "delta"].map((n) => path.join(dir, n)),
      out,
      cwd: root,
    });
    expect(await findingsIn(out, await portfolioPages(result))).toEqual([]);
    const getting = await fs.readFile(
      path.join(out, "getting-started.md"),
      "utf8",
    );
    expect(getting).toMatch(/cycle/i);
  });

  it("keeps the change step short when many repositories depend on one", async () => {
    const dir = path.join(root, "large");
    const paths = [
      await writeRepo(
        path.join(dir, "core"),
        {
          "README.md": "# Core\n\nCore library shared by every service.\n",
          "package.json": json({ name: "@y/core", scripts: { test: "jest" } }),
        },
        { remote: "git@github.com:y/core.git" },
      ),
    ];
    for (let i = 1; i <= 12; i += 1) {
      const name = `svc-${String(i).padStart(2, "0")}`;
      paths.push(
        await writeRepo(
          path.join(dir, name),
          {
            "README.md": `# ${name}\n\nService ${i} that uses the core library.\n`,
            "package.json": json({
              name: `@y/${name}`,
              dependencies: { "@y/core": "1" },
            }),
          },
          { remote: `git@github.com:y/${name}.git` },
        ),
      );
    }
    const out = path.join(root, "large-out");
    const result = await scanPortfolio({ paths, out, cwd: root });
    expect(await findingsIn(out, await portfolioPages(result))).toEqual([]);
  });

  it("checks a portfolio with no checks at all", async () => {
    const bare = path.join(root, "bare", "notes");
    await fs.mkdir(bare, { recursive: true });
    const out = path.join(root, "bare-out");
    const result = await scanPortfolio({ paths: [bare], out, cwd: root });
    const learn = await fs.readFile(path.join(out, "learn.md"), "utf8");
    expect(learn).toContain("gaps.md");
    expect(await findingsIn(out, await portfolioPages(result))).toEqual([]);
  });
});

describe("pages xfeat scan writes follow the STE-lite rules", () => {
  const root = tempRoot("prose-scan");

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("checks every fixture repository", async () => {
    const repos = await createPortfolioFixture(path.join(root, "fixture"));
    for (const repo of repos) {
      const copy = path.join(root, "scan", path.basename(repo));
      await fs.cp(repo, copy, { recursive: true });
      await scanProfessionalDocs(copy);
      const pages = await scanPages(copy);
      expect(pages.length).toBeGreaterThan(3);
      expect(await findingsIn(copy, pages)).toEqual([]);
    }
  });

  it("checks workspaces, subfolder manifests, and quoted descriptions", async () => {
    const members = {};
    for (let i = 1; i <= 30; i += 1) {
      members[`packages/p${i}/package.json`] = json({ name: `p${i}` });
      members[`packages/p${i}/index.js`] = `export const p${i} = ${i};\n`;
    }
    const cases = {
      workspace: {
        "README.md": "# Workspace\n\nA workspace with many small packages.\n",
        "package.json": json({
          name: "ws",
          workspaces: ["packages/*"],
          scripts: { test: "jest" },
        }),
        ...members,
      },
      subfolders: {
        "services/api/package.json": json({ name: "api", description: "API" }),
        "services/api/src/index.js": "export function api() {}\n",
        "services/web/package.json": json({ name: "web" }),
        "services/web/src/index.js": "export const web = 1;\n",
      },
      described: {
        "README.md": "# Tool\n",
        "package.json": json({
          name: "tool",
          description: "Converts invoices to PDF files; it's fast",
          workspaces: ["packages/*"],
          scripts: { test: "jest" },
        }),
        "packages/core/package.json": json({
          name: "core",
          description: "Core billing logic; it's shared by every service",
        }),
        "packages/core/index.js": "export const core = 1;\n",
      },
    };
    for (const [name, files] of Object.entries(cases)) {
      const dir = path.join(root, name);
      await writeRepo(dir, files, { git: false });
      await scanProfessionalDocs(dir);
      const pages = await scanPages(dir);
      expect(pages.length).toBeGreaterThan(2);
      expect(await findingsIn(dir, pages)).toEqual([]);
    }
    // A title-only README falls back to the manifest description, quoted
    // verbatim and cited from the manifest, not from the README title.
    const overview = await fs.readFile(
      path.join(root, "described", "docs/architecture/overview.md"),
      "utf8",
    );
    expect(overview).toContain("as its manifest describes it");
    expect(overview).toContain("package.json:");
    expect(overview).not.toContain("README.md:1");
    expect(overview).toContain(
      "  > Converts invoices to PDF files; it's fast\n",
    );
  });
});
