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

  it("treats equivalent package manager test invocations as the same command", () => {
    const scripts = (values) =>
      check("test-command:web", "test-command", "one-of", values, "web");
    const grade = (values, answer) =>
      gradeAnswers([scripts(values)], { "test-command:web": answer }).score;
    expect(grade(["npm run test"], "npm test")).toBe(1);
    expect(grade(["npm run test"], "npm t")).toBe(1);
    expect(grade(["npm run test"], "npm run-script test")).toBe(1);
    expect(grade(["pnpm run test"], "pnpm test")).toBe(1);
    expect(grade(["yarn run test"], "yarn test")).toBe(1);
    expect(grade(["corepack pnpm test"], "pnpm run test")).toBe(1);
    expect(grade(["npm run test -- --watch"], "npm test -- --watch")).toBe(1);
    // `bun test` runs Bun's built-in runner, not the "test" script.
    expect(grade(["bun run test"], "bun test")).toBe(0);
    expect(grade(["npm run test"], "pnpm test")).toBe(0);
    expect(grade(["npm run test:unit"], "npm test")).toBe(0);
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

  it("reports accuracy per hop count so joins are visible apart from lookups", () => {
    const join = {
      ...check("program-test-command:cli", "test-command", "one-of", [
        "make test",
      ]),
      hops: 2,
    };
    const report = gradeAnswers([...checks, join], {
      "owner:api": ["group:core", "@acme/payments"],
      "program-test-command:cli": "make test",
    });
    expect(report.byHops).toEqual({
      1: { correct: 1, total: 5 },
      2: { correct: 1, total: 1 },
    });
  });

  it("normalizes join and closure answers like the single-hop kind they extend", () => {
    const join = (id, kind, type, values) => ({
      ...check(id, kind, type, values),
      hops: 2,
    });
    const report = gradeAnswers(
      [
        join("program-test-command:cli", "program-test-command", "one-of", [
          "npm run test",
        ]),
        join("program-owner:cli", "program-owner", "set", ["@acme/tools"]),
        join("program-siblings:cli", "program-siblings", "set", ["acme-lint"]),
        join("transitive-dependencies:web", "transitive-dependencies", "set", [
          "api",
          "ledger",
        ]),
      ],
      {
        "program-test-command:cli": "npm test",
        "program-owner:cli": "@ACME/tools",
        "program-siblings:cli": ["Acme-Lint"],
        "transitive-dependencies:web": "Ledger, API",
      },
    );
    expect(report.results.map((r) => r.result)).toEqual([
      "correct",
      "correct",
      "correct",
      "correct",
    ]);
  });

  it("reports the score of always guessing the most common answer", () => {
    const testCheck = (subject, values) => ({
      ...check(`test-command:${subject}`, "test-command", "one-of", values),
      subject,
    });
    const portfolio = [
      testCheck("a", ["npm run test"]),
      testCheck("b", ["npm run test", "make test"]),
      testCheck("c", ["npm run test"]),
      testCheck("d", ["cargo test"]),
      check("owner:a", "owner", "set", ["@acme/a"]),
    ];
    const report = gradeAnswers(portfolio, {});
    // Leaving each question out, "npm run test" is still the most common
    // answer for a, b, c, and d; it is right for a, b, and c. The only owner
    // question has no other owner to guess from.
    expect(report.baseline).toEqual({
      score: 0.6,
      correct: 3,
      byHops: { 1: { correct: 3, total: 5 } },
    });
  });

  it("marks a hedged list of several answers to a one-of question wrong", () => {
    const report = gradeAnswers(checks, {
      "test-command:api": ["make test", "go test ./..."],
    });
    const result = report.results.find((r) => r.id === "test-command:api");
    expect(result.result).toBe("wrong");
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
    // One answer per question, as a reader gives it: a set answer lists every
    // value, any other answer names one value.
    const correct = Object.fromEntries(
      checks.map((item) => [
        item.id,
        item.answer.type === "set" ? item.answer.values : item.answer.values[0],
      ]),
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

  it("rejects an empty --min-score instead of disabling the gate", async () => {
    const file = await writeAnswers({});
    for (const flag of ["--min-score=", "--min-score= "]) {
      const report = await runPortfolioCommand(
        ["grade", "--out", outDir, "--answers", file, flag],
        io,
      );
      expect(report.exitCode).toBe(1);
      expect(report.error).toMatch(/--min-score/);
    }
  });

  it("names checks.json when it is corrupt or malformed", async () => {
    const broken = path.join(root, "broken");
    await fs.mkdir(broken, { recursive: true });
    for (const body of ["{not json", "null", '{"checks":[null]}']) {
      await fs.writeFile(path.join(broken, "checks.json"), body);
      const report = await runPortfolioCommand(
        ["questions", "--out", broken],
        io,
      );
      expect(report.exitCode).toBe(1);
      expect(report.error).toContain(path.join(broken, "checks.json"));
    }
  });
});

describe("dependency file answers", () => {
  const fileCheck = (subject, values) => ({
    id: `dependency-file:${subject}->lib`,
    kind: "dependency-file",
    subject,
    answer: { type: "one-of", values },
  });
  const grade = (check, answer) =>
    gradeAnswers([check], { [check.id]: answer }).score;

  it("strips a repository prefix from the answer but not from the expected path", () => {
    const nested = fileCheck("website", ["website/package.json"]);
    expect(grade(nested, "package.json")).toBe(0);
    expect(grade(nested, "website/package.json")).toBe(1);
    expect(grade(nested, "./website/package.json")).toBe(1);
    const plain = fileCheck("api", ["go.mod"]);
    expect(grade(plain, "api/go.mod")).toBe(1);
    expect(grade(plain, "go.mod")).toBe(1);
  });
});
