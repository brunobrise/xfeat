const fs = require("fs/promises");
const path = require("path");
const { byText } = require("./portfolio-util");

// Grades answers against checks.json. The same questions serve a person
// testing themselves and an evaluation of a coding agent with and without the
// generated docs. Grading is deterministic: no model judges the answers.

const CHECKS_FILE = "checks.json";
const CASE_INSENSITIVE = new Set([
  "owner",
  "binary",
  "dependencies",
  "package-provider",
  "impact",
]);

function clean(value) {
  let text = String(value).trim();
  while (text.length > 1 && text.startsWith("`") && text.endsWith("`")) {
    text = text.slice(1, -1).trim();
  }
  return text.replace(/\s+/g, " ");
}

// npm, pnpm, and yarn run the "test" script for `test`, `run test`, and the
// npm and pnpm `t` alias; `corepack` only pins the package manager version.
// `bun test` starts Bun's built-in runner instead of the script, so bun
// commands are left as written.
function canonicalCommand(text) {
  return text
    .replace(/^corepack /, "")
    .replace(/^npm run-script /, "npm run ")
    .replace(/^(npm|pnpm) t(?= |$)/, "$1 run test")
    .replace(/^(npm|pnpm|yarn) test(?= |$)/, "$1 run test");
}

function normalize(check, value) {
  let text = clean(value);
  if (CASE_INSENSITIVE.has(check.kind)) text = text.toLowerCase();
  if (check.kind === "test-command") text = canonicalCommand(text);
  if (check.kind === "dependency-file") {
    text = text.replace(/\\/g, "/").replace(/^\.\//, "");
  }
  return text;
}

// A reader may prefix a file path with its repository (`api/go.mod`). Only
// the answer gets that prefix removed: the expected path is relative to the
// repository root and may itself start with a folder named like the repo.
function answerVariants(check, value) {
  if (check.kind !== "dependency-file") return [value];
  const variants = [value];
  for (const prefix of [`${check.subject}/`, `${check.subject}:`]) {
    if (value.startsWith(prefix)) {
      variants.push(value.slice(prefix.length).replace(/^\.\//, ""));
    }
  }
  return variants;
}

// A set answer may be a list or a comma-separated string. Single-value
// answers are taken whole, because commands may contain commas.
function givenValues(check, value) {
  const items = Array.isArray(value)
    ? value
    : check.answer.type === "set"
      ? String(value).split(",")
      : [value];
  return items.map((item) => normalize(check, item)).filter(Boolean);
}

function isCorrect(check, given) {
  const expected = check.answer.values.map((item) => normalize(check, item));
  if (check.answer.type === "set") {
    const a = [...new Set(given)].sort(byText);
    const b = [...new Set(expected)].sort(byText);
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return (
    given.length === 1 &&
    answerVariants(check, given[0]).some((value) => expected.includes(value))
  );
}

function answerMap(input) {
  const map =
    input && typeof input === "object" && !Array.isArray(input) && input.answers
      ? input.answers
      : input;
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    throw new Error(
      "Answers must be a JSON object that maps check ids to answers.",
    );
  }
  for (const [id, value] of Object.entries(map)) {
    const valid = Array.isArray(value)
      ? value.every((item) => typeof item === "string")
      : typeof value === "string";
    if (!valid) {
      throw new Error(
        `Answer for ${id} must be a string or a list of strings.`,
      );
    }
  }
  return map;
}

function score(checks, answers) {
  const results = checks.map((check) => {
    const base = { id: check.id, expected: check.answer.values };
    if (!Object.prototype.hasOwnProperty.call(answers, check.id)) {
      return { ...base, result: "missing" };
    }
    const given = givenValues(check, answers[check.id]);
    return { ...base, result: isCorrect(check, given) ? "correct" : "wrong" };
  });
  const correct = results.filter((r) => r.result === "correct").length;
  // Lookups are easy to answer by search; joins and closures are where docs
  // can make a difference, so they are reported apart.
  const byHops = {};
  checks.forEach((check, i) => {
    const hops = Number.isInteger(check.hops) ? check.hops : 1;
    byHops[hops] = byHops[hops] || { correct: 0, total: 0 };
    byHops[hops].total += 1;
    if (results[i].result === "correct") byHops[hops].correct += 1;
  });
  const ratio = checks.length
    ? Math.round((correct / checks.length) * 10000) / 10000
    : 0;
  return { score: ratio, correct, byHops, results };
}

// Answers that share a domain share a guessing pool: a join about test
// commands is guessed from all test-command answers.
const POOL = {
  "program-test-command": "test-command",
  "program-owner": "owner",
  "transitive-dependencies": "dependencies",
};

// The answers a reader gets without reading anything: for each question, the
// value that most other questions of its kind expect, leaving the question
// itself out so its own answer cannot leak into the guess.
function guessAnswers(checks, pool) {
  const guesses = {};
  for (const check of checks) {
    const kind = POOL[check.kind] || check.kind;
    const counts = new Map();
    for (const other of pool) {
      if (other.id === check.id || (POOL[other.kind] || other.kind) !== kind) {
        continue;
      }
      for (const value of new Set(other.answer.values)) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
    }
    const top = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || byText(a[0], b[0]),
    )[0];
    if (top)
      guesses[check.id] = check.answer.type === "set" ? [top[0]] : top[0];
  }
  return guesses;
}

// `pool` is every check in the portfolio when `checks` is only a sample, so
// the guess baseline reflects the whole portfolio.
function gradeAnswers(checks, input, { pool = checks } = {}) {
  const answers = answerMap(input);
  const graded = score(checks, answers);
  const baseline = score(checks, guessAnswers(checks, pool));
  const known = new Set(checks.map((check) => check.id));
  return {
    score: graded.score,
    correct: graded.correct,
    total: checks.length,
    byHops: graded.byHops,
    baseline: {
      score: baseline.score,
      correct: baseline.correct,
      byHops: baseline.byHops,
    },
    answered: graded.results.filter((r) => r.result !== "missing").length,
    results: graded.results,
    unknown: Object.keys(answers)
      .filter((id) => !known.has(id))
      .sort(byText),
  };
}

async function readChecks(outDir) {
  const file = path.join(outDir, CHECKS_FILE);
  let text;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(
      `${file} not found. Run xfeat portfolio scan before questions or grade.`,
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  if (!data || !Array.isArray(data.checks)) {
    throw new Error(`${file} has no checks list. Run xfeat portfolio scan.`);
  }
  if (!data.checks.every(isWellFormed)) {
    throw new Error(`${file} has a malformed check. Run xfeat portfolio scan.`);
  }
  return data;
}

function isWellFormed(check) {
  return (
    check !== null &&
    typeof check === "object" &&
    typeof check.id === "string" &&
    Array.isArray(check.answer?.values) &&
    check.answer.values.every((value) => typeof value === "string")
  );
}

function parseMinScore(value) {
  if (value === undefined) return null;
  // Number("") is 0, so an unset shell variable would disable the gate.
  if (String(value).trim() === "") {
    throw new Error("--min-score must be a number from 0 to 1.");
  }
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error("--min-score must be a number from 0 to 1.");
  }
  return score;
}

// Prints the questions without answers or cited claims, so they can be given
// to a reader or an agent under evaluation.
async function questionsPortfolio(outDir) {
  const data = await readChecks(outDir);
  return {
    ok: true,
    outDir,
    focus: data.focus,
    questions: data.checks.map((check) => ({
      id: check.id,
      step: check.step,
      question: check.question,
      format: check.format,
    })),
  };
}

async function gradePortfolio(outDir, options) {
  if (!options.answers) throw new Error("portfolio grade requires --answers");
  const minScore = parseMinScore(options.minScore);
  const data = await readChecks(outDir);
  const answersPath = path.resolve(
    options.cwd || process.cwd(),
    options.answers,
  );
  let input;
  try {
    input = JSON.parse(await fs.readFile(answersPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read answers from ${answersPath}: ${error.message}`,
    );
  }
  const report = gradeAnswers(data.checks, input);
  return {
    ok: minScore === null || report.score >= minScore,
    outDir,
    ...(minScore === null ? {} : { minScore }),
    ...report,
  };
}

module.exports = { gradeAnswers, gradePortfolio, questionsPortfolio };
