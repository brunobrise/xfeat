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

function normalize(check, value) {
  let text = clean(value);
  if (CASE_INSENSITIVE.has(check.kind)) text = text.toLowerCase();
  if (check.kind === "dependency-file") {
    text = text.replace(/\\/g, "/").replace(/^\.\//, "");
    for (const prefix of [`${check.subject}/`, `${check.subject}:`]) {
      if (text.startsWith(prefix)) text = text.slice(prefix.length);
    }
    text = text.replace(/^\.\//, "");
  }
  return text;
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
  return given.length === 1 && expected.includes(given[0]);
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

function gradeAnswers(checks, input) {
  const answers = answerMap(input);
  const results = checks.map((check) => {
    const base = { id: check.id, expected: check.answer.values };
    if (!Object.prototype.hasOwnProperty.call(answers, check.id)) {
      return { ...base, result: "missing" };
    }
    const given = givenValues(check, answers[check.id]);
    return { ...base, result: isCorrect(check, given) ? "correct" : "wrong" };
  });
  const known = new Set(checks.map((check) => check.id));
  const correct = results.filter((r) => r.result === "correct").length;
  const total = checks.length;
  return {
    score: total ? Math.round((correct / total) * 10000) / 10000 : 0,
    correct,
    total,
    answered: results.filter((r) => r.result !== "missing").length,
    results,
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
  const data = JSON.parse(text);
  if (!Array.isArray(data.checks)) {
    throw new Error(`${file} has no checks list.`);
  }
  return data;
}

function parseMinScore(value) {
  if (value === undefined) return null;
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
