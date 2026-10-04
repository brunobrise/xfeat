const path = require("path");
const fs = require("fs/promises");
const fg = require("fast-glob");
const { scanPortfolio } = require("./lib/portfolio-docs");
const { scanProfessionalDocs } = require("./lib/professional-docs");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");
const { proseFindings } = require("./test_files/prose-lint");

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(60000);

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
const rules = (markdown, options) =>
  proseFindings(markdown, options).map((finding) => finding.rule);

describe("STE-lite prose rules", () => {
  it("limits descriptive sentences to 25 words and steps to 20", () => {
    expect(rules(`${words(25)}.`)).toEqual([]);
    expect(rules(`${words(26)}.`)).toEqual(["sentence-length"]);
    expect(rules(`1. Run ${words(19)}.`)).toEqual([]);
    expect(rules(`1. Run ${words(20)}.`)).toEqual(["step-length"]);
    // A numbered question is not a procedure step.
    expect(rules(`1. Which ${words(22)}?`)).toEqual([]);
  });

  it("allows one instruction per step", () => {
    expect(rules("1. Clone `api`. Run `make test`.")).toEqual([
      "one-instruction",
    ]);
    expect(rules("1. Clone `api`, then run `make test`.")).toEqual([
      "one-instruction",
    ]);
    expect(rules("1. Clone `api` and then run `make test`.")).toEqual([
      "one-instruction",
    ]);
  });

  it("limits paragraphs to six sentences", () => {
    const sentence = "One short sentence here.";
    expect(rules(Array(6).fill(sentence).join("\n"))).toEqual([]);
    expect(rules(Array(7).fill(sentence).join("\n"))).toEqual([
      "paragraph-length",
    ]);
    expect(rules(Array(7).fill(sentence).join("\n\n"))).toEqual([]);
  });

  it("rejects semicolons, contractions, and passive voice", () => {
    expect(rules("Links break; check them.")).toEqual(["semicolon"]);
    expect(rules("It doesn't run.")).toEqual(["contraction"]);
    expect(rules("The repository's owner is listed.")).toEqual(["passive"]);
    expect(rules("Commands are copied from CI.")).toEqual(["passive"]);
    expect(
      rules("Commands are copied from CI.", { allow: [/are copied from CI/] }),
    ).toEqual([]);
  });

  it("skips quoted source text, tables, headings, code, and comments", () => {
    const long = words(30);
    const page = [
      "---",
      `title: ${long}`,
      "---",
      `# ${long}`,
      `> ${long}; it's quoted.`,
      `  > ${long}`,
      `| ${long} | a; b |`,
      "```",
      `${long}; done`,
      "```",
      "<!-- xfeat scan overwrites this file; keep it. -->",
      "Run `a; b && c` now.",
    ].join("\n");
    expect(rules(page)).toEqual([]);
  });
});

async function findingsIn(dir, files) {
  const out = [];
  for (const file of files) {
    const text = await fs.readFile(path.join(dir, file), "utf8");
    for (const finding of proseFindings(text, { allow: ALLOWED_PASSIVES })) {
      out.push({ file, ...finding });
    }
  }
  return out;
}

// Passive sentences whose doer is unknown, as rule 3.6 allows. Each entry
// says why the doer cannot be named.
const ALLOWED_PASSIVES = [];

describe("generated pages follow the STE-lite rules", () => {
  const root = tempRoot("portfolio-prose");
  let repos;

  beforeAll(async () => {
    repos = await createPortfolioFixture(path.join(root, "repos"));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("checks every page that xfeat portfolio scan writes", async () => {
    const outDir = path.join(root, "portfolio-out");
    const manifest = path.join(root, "xfeat.portfolio.json");
    await fs.writeFile(
      manifest,
      JSON.stringify({
        name: "Acme Billing",
        output: "portfolio-out",
        repos: repos.map((repo) =>
          path.basename(repo) === "sync-worker"
            ? {
                path: "repos/sync-worker",
                owner: "@acme/data",
                notes:
                  "Runs nightly; ask the data team before changing the schedule. It's fragile.",
              }
            : { path: `repos/${path.basename(repo)}` },
        ),
      }),
    );
    const result = await scanPortfolio({ manifest, cwd: root });
    const pages = result.documents.filter((doc) => doc.endsWith(".md"));
    expect(pages.length).toBeGreaterThan(10);
    expect(await findingsIn(outDir, pages)).toEqual([]);
  });

  it("checks every page that xfeat scan writes", async () => {
    for (const name of ["billing-api", "billing-web", "sync-worker"]) {
      const copy = path.join(root, "scan", name);
      await fs.cp(path.join(root, "repos", name), copy, { recursive: true });
      await scanProfessionalDocs(copy);
      // Only pages xfeat wrote, marked as generated; a repository's own docs
      // belong to its authors.
      const pages = [];
      for (const page of await fg(["docs/**/*.md", "xfeat-report.md"], {
        cwd: copy,
      })) {
        const text = await fs.readFile(path.join(copy, page), "utf8");
        if (text.startsWith("<!-- xfeat:generated")) pages.push(page);
      }
      expect(pages.length).toBeGreaterThan(3);
      expect(await findingsIn(copy, pages)).toEqual([]);
      // The README summary is quoted, not rewritten into xfeat's sentence.
      const overview = await fs.readFile(
        path.join(copy, "docs/architecture/overview.md"),
        "utf8",
      );
      expect(overview).toMatch(/^ {2}> \S/m);
    }
  });
});
