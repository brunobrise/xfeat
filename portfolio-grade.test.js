const path = require("path");
const fs = require("fs/promises");
const { gradeAnswers } = require("./lib/portfolio-grade");
const { scanPortfolio } = require("./lib/portfolio-docs");
const { runPortfolioCommand } = require("./lib/portfolio-cli");
const {
  createPortfolioFixture,
  tempRoot,
} = require("./test_files/portfolio-fixture");

// These suites create real git repositories; allow for slow CI runners.
jest.setTimeout(30000);

const check = (id, kind, type, values, subject = "api") => ({
  id,
  kind,
  subject,
  answer: { type, values },
});

describe("gradeAnswers", () => {
  const checks = [
    check("owner:api", "owner", "set", ["@acme/payments", "group:core"]),
    check("test-command:api", "test-command", "one-of", [
      "make test",
      "go test ./...",
    ]),
    check("dependency-file:api->lib", "dependency-file", "one-of", ["go.mod"]),
    check("impact:lib", "impact", "set", ["api", "web"], "lib"),
    check("binary:ledger", "binary", "value", ["ledger"], "ledger"),
  ];

  it("normalizes case, backticks, whitespace, and repository prefixes", () => {
    const report = gradeAnswers(checks, {
      "owner:api": "GROUP:core, `@acme/payments`",
      "test-command:api": "  go   test ./...  ",
      "dependency-file:api->lib": "./api/go.mod",
      "impact:lib": ["Web", "api"],
      "binary:ledger": "`Ledger`",
    });
    expect(report).toMatchObject({ score: 1, correct: 5, total: 5 });
  });

  it("marks wrong, missing, and unknown answers", () => {
    const report = gradeAnswers(checks, {
      "owner:api": "@acme/payments",
      "test-command:api": "make TEST",
      "impact:lib": "api, web, docs",
      "nope:id": "x",
    });
    expect(report.correct).toBe(0);
    expect(report.score).toBe(0);
    const byId = Object.fromEntries(report.results.map((r) => [r.id, r]));
    expect(byId["owner:api"]).toMatchObject({
      result: "wrong",
      expected: ["@acme/payments", "group:core"],
    });
    expect(byId["binary:ledger"].result).toBe("missing");
    expect(report.unknown).toEqual(["nope:id"]);
  });

  it("rounds the score and accepts a wrapped answers object", () => {
    const report = gradeAnswers(checks.slice(0, 3), {
      answers: { "owner:api": ["group:core", "@acme/payments"] },
    });
    expect(report.score).toBe(0.3333);
  });

  it("rejects answers that are not strings or lists of strings", () => {
    expect(() => gradeAnswers(checks, { "owner:api": 3 })).toThrow(/owner:api/);
    expect(() => gradeAnswers(checks, [])).toThrow(/object/);
  });
});

describe("xfeat portfolio questions and grade", () => {
  const root = tempRoot("portfolio-grade");
  const outDir = path.join(root, "out");
  let output;
  const io = { cwd: root, stdout: (message) => output.push(message) };

  beforeAll(async () => {
    const repos = await createPortfolioFixture(path.join(root, "repos"));
    await scanPortfolio({ paths: repos, out: outDir, cwd: root });
  });

  beforeEach(() => {
    output = [];
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const writeAnswers = async (answers) => {
    const file = path.join(root, "answers.json");
    await fs.writeFile(file, JSON.stringify(answers));
    return file;
  };

  it("prints questions without answers or claims", async () => {
    const report = await runPortfolioCommand(
      ["questions", "--out", outDir],
      io,
    );
    expect(report.exitCode).toBe(0);
    expect(report.questions.length).toBeGreaterThan(0);
    expect(report.questions[0]).toEqual({
      id: expect.any(String),
      step: expect.any(String),
      question: expect.any(String),
      format: expect.any(String),
    });
    expect(output.join("\n")).not.toContain('"answer"');
  });

  it("scores a correct answer file at 1 and an empty one at 0", async () => {
    const { checks } = JSON.parse(
      await fs.readFile(path.join(outDir, "checks.json"), "utf8"),
    );
    const correct = Object.fromEntries(
      checks.map((item) => [item.id, item.answer.values]),
    );
    const full = await runPortfolioCommand(
      ["grade", "--out", outDir, "--answers", await writeAnswers(correct)],
      io,
    );
    expect(full).toMatchObject({ exitCode: 0, score: 1 });
    const empty = await runPortfolioCommand(
      ["grade", "--out", outDir, "--answers", await writeAnswers({})],
      io,
    );
    expect(empty).toMatchObject({ exitCode: 0, score: 0 });
  });

  it("fails below --min-score and rejects invalid thresholds", async () => {
    const file = await writeAnswers({});
    const below = await runPortfolioCommand(
      ["grade", "--out", outDir, "--answers", file, "--min-score", "0.5"],
      io,
    );
    expect(below).toMatchObject({ exitCode: 1, ok: false, score: 0 });
    const invalid = await runPortfolioCommand(
      ["grade", "--out", outDir, "--answers", file, "--min-score", "2"],
      io,
    );
    expect(invalid.exitCode).toBe(1);
    expect(invalid.error).toMatch(/--min-score/);
  });

  it("reports a missing checks.json or answers file as an error", async () => {
    const missing = await runPortfolioCommand(
      ["grade", "--out", path.join(root, "nowhere"), "--answers", "a.json"],
      io,
    );
    expect(missing.error).toMatch(/checks\.json/);
    const noAnswers = await runPortfolioCommand(["grade", "--out", outDir], io);
    expect(noAnswers.error).toMatch(/--answers/);
  });
});
