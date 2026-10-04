const { code, frontmatter } = require("./portfolio-links");
const { integrationPath } = require("./portfolio-renderers");
const {
  declaredEdges,
  impactClosure,
  testCommands,
} = require("./portfolio-checks");
const { byText } = require("./portfolio-util");

// Renders learn.md: one ordered path of at most five steps (orient, run,
// trace, impact, change). Each step has one goal, links to read, declared
// commands, and at most three checks with hidden, cited answers. Steps without
// evidence are omitted. Sentences stay at 25 words or fewer (STE-lite); see
// docs/research/01a10804fd3079f7-explorable-docs-curriculum-research.md.

const MAX_CHECKS = 3;
const MAX_SOURCES = 3;
const MAX_PATHS = 10;

function joinCodes(values) {
  return values.map(code).join(", ");
}

function answerText(check) {
  const values = joinCodes(check.answer.values);
  return check.answer.type === "one-of" && check.answer.values.length > 1
    ? `Any of: ${values}.`
    : `${values}.`;
}

function sourceText(check, claims, links) {
  if (check.manifest && !check.claims.length) {
    return "Source: the portfolio manifest.";
  }
  const cited = check.claims
    .map((id) => claims.get(id))
    .filter((claim) => claim?.evidence)
    .map((claim) => links.evidence(claim.evidence, ""));
  const shown = cited.slice(0, MAX_SOURCES).join(", ");
  const more = cited.length - MAX_SOURCES;
  return `Source: ${shown}${more > 0 ? `, and ${more} more in \`checks.json\`` : ""}.`;
}

function renderChecks(checks, claims, links) {
  if (!checks.length) return [];
  const lines = ["Checks:", ""];
  checks.forEach((check, index) => {
    lines.push(
      `${index + 1}. ${check.question}`,
      "",
      "   <details><summary>Answer</summary>",
      "",
      `   ${answerText(check)} ${sourceText(check, claims, links)}`,
      "",
      "   </details>",
      "",
    );
  });
  return lines;
}

function list(items, numbered = false) {
  if (!items.length) return [];
  return [
    ...items.map((item, i) => `${numbered ? `${i + 1}.` : "-"} ${item}`),
    "",
  ];
}

// Checks shown in a step, at most three. Orientation is about the whole
// portfolio, so it fills up with other repositories after the focus; the
// other steps only ask about the repositories the step works on.
function pick(checks, step, subjects, { others = false } = {}) {
  const inStep = checks.filter((check) => check.step === step);
  const ranked = [
    ...inStep.filter((check) => subjects.includes(check.subject)),
    ...(others
      ? inStep.filter((check) => !subjects.includes(check.subject))
      : []),
  ];
  return ranked.slice(0, MAX_CHECKS);
}

function providersOf(slug, edges) {
  const found = new Set();
  const queue = [slug];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of edges.filter((item) => item.from === current)) {
      if (found.has(edge.to) || edge.to === slug) continue;
      found.add(edge.to);
      queue.push(edge.to);
    }
  }
  return found;
}

// Prefer an edge of the focus repository, consumer side first. Otherwise any
// declared edge still teaches how to read a dependency.
function traceEdge(focus, edges) {
  const touches = (edge) => edge.from === focus || edge.to === focus;
  const ranked = [...edges].sort(
    (a, b) =>
      Number(touches(b)) - Number(touches(a)) ||
      Number(b.from === focus) - Number(a.from === focus) ||
      byText(a.id, b.id),
  );
  return ranked[0] || null;
}

function impactSubject(checks) {
  const impacts = checks
    .filter((check) => check.kind === "impact")
    .sort(
      (a, b) =>
        b.answer.values.length - a.answer.values.length ||
        byText(a.subject, b.subject),
    );
  return impacts[0]?.subject || "";
}

function pathLine(chain, links) {
  const slugs = [chain[0].from, ...chain.map((edge) => edge.to)];
  const sources = chain
    .map((edge) => links.evidence(edge.consumer, ""))
    .join(", ");
  return `${slugs.map(code).join(" → ")} (${sources})`;
}

function orientStep(ctx) {
  return {
    title: "Orient",
    body: [
      "Goal: Learn which repositories exist, what each one is for, and who owns them.",
      "",
      "Read:",
      "",
      ...list([
        "[index.md](index.md) for purpose, owner, and status.",
        "[landscape.md](landscape.md) for declared dependencies.",
      ]),
      ...renderChecks(
        pick(ctx.checks, "orient", [ctx.focus], { others: true }),
        ctx.claims,
        ctx.links,
      ),
    ],
  };
}

function runStep(ctx) {
  const { focus, edges } = ctx;
  const providers = providersOf(focus, edges);
  const clone = ctx.model.cloneOrder
    .map((item) => item.slug)
    .filter((slug) => slug === focus || providers.has(slug));
  const test = testCommands(ctx.repo)[0];
  const steps = clone.map((slug) => `Clone ${code(slug)}.`);
  if (test) steps.push(`In ${code(focus)}, run ${code(test.command)}.`);
  return {
    title: `Run ${code(focus)}`,
    body: [
      test
        ? `Goal: Clone ${code(focus)} and its providers, then run its tests.`
        : `Goal: Clone ${code(focus)} and the repositories it depends on.`,
      "",
      "Read:",
      "",
      ...list([
        "[getting-started.md](getting-started.md) for the full clone order.",
        `[repos/${focus}.md](repos/${focus}.md) for every declared command.`,
      ]),
      "Do:",
      "",
      ...list(steps, true),
      ...(test
        ? [
            "xfeat copied these commands from the repositories. It did not run them.",
            "",
          ]
        : []),
      ...renderChecks(pick(ctx.checks, "run", [focus]), ctx.claims, ctx.links),
    ],
  };
}

function traceStep(ctx) {
  const edge = traceEdge(ctx.focus, ctx.edges);
  if (!edge) return null;
  const related = ctx.checks.filter(
    (check) =>
      check.id === `dependencies:${edge.from}` ||
      check.id === `dependency-file:${edge.from}->${edge.to}` ||
      check.id === `package-provider:${edge.dependency}`,
  );
  const read = [
    `[${integrationPath(edge.from, edge.to)}](${integrationPath(edge.from, edge.to)}) for both sides of the dependency.`,
    `Consumer line: ${ctx.links.evidence(edge.consumer, "")}.`,
  ];
  if (edge.provider) {
    read.push(`Provider line: ${ctx.links.evidence(edge.provider, "")}.`);
  }
  return {
    title: `Trace ${code(edge.from)} to ${code(edge.to)}`,
    body: [
      "Goal: Follow one declared dependency from the consumer line to the provider line.",
      "",
      "Read:",
      "",
      ...list(read),
      `Explain: In one sentence, say why ${code(edge.from)} needs ${code(edge.to)}. Then compare your answer with the consumer line.`,
      "",
      ...renderChecks(related.slice(0, MAX_CHECKS), ctx.claims, ctx.links),
    ],
  };
}

function impactStep(ctx) {
  const subject = impactSubject(ctx.checks);
  if (!subject) return null;
  const closure = impactClosure(subject, ctx.edges);
  const chains = [...closure.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([, chain]) => pathLine(chain, ctx.links));
  const hidden = chains.length - MAX_PATHS;
  return {
    title: `Assess the impact of ${code(subject)}`,
    body: [
      `Goal: Find which repositories a change in ${code(subject)} can affect.`,
      "",
      "Each arrow points from a repository to the repository it depends on:",
      "",
      ...list(chains.slice(0, MAX_PATHS)),
      ...(hidden > 0
        ? [
            `${hidden} more repositories appear in the answer to the check below.`,
            "",
          ]
        : []),
      ...renderChecks(
        pick(ctx.checks, "impact", [subject]),
        ctx.claims,
        ctx.links,
      ),
    ],
  };
}

function changeStep(ctx) {
  const test = testCommands(ctx.repo)[0];
  if (!test) return null;
  const dependents = [...impactClosure(ctx.focus, ctx.edges).keys()].sort(
    byText,
  );
  const retest = dependents.length
    ? `Run the tests of each repository that depends on ${code(ctx.focus)}: ${joinCodes(dependents)}.`
    : `No selected repository declares a dependency on ${code(ctx.focus)}.`;
  return {
    title: `Change ${code(ctx.focus)}`,
    body: [
      `Goal: Make one small change in ${code(ctx.focus)} and confirm that nothing else breaks.`,
      "",
      "Do:",
      "",
      ...list(
        [
          `Change one line in ${code(ctx.focus)}.`,
          `Run ${code(test.command)} in ${code(ctx.focus)}.`,
          retest,
        ],
        true,
      ),
    ],
  };
}

function renderLearn(model, plan, links) {
  const edges = declaredEdges(model).filter((edge) => edge.consumer);
  const ctx = {
    model,
    links,
    edges,
    focus: plan.focus,
    repo: model.repos.find((repo) => repo.slug === plan.focus),
    checks: plan.checks,
    claims: new Map(model.claims.map((claim) => [claim.id, claim])),
  };
  const steps = ctx.repo
    ? [orientStep, runStep, traceStep, impactStep, changeStep]
        .map((build) => build(ctx))
        .filter(Boolean)
    : [];
  const intro = [
    "Follow the steps in order. Each step has one goal and at most three checks.",
    "Skip a step when you can answer its checks without opening the answers.",
    "Each answer links to the source line it comes from.",
  ];
  if (!plan.checks.length) {
    intro.push(
      "No checks exist yet: no declared owners, test commands, programs, or dependencies were found. See [gaps.md](gaps.md).",
    );
  }
  return [
    ...frontmatter("learning-path", "Learning path"),
    "# Learning Path",
    "",
    intro.join(" "),
    "",
    ...steps.flatMap((step, index) => [
      `## ${index + 1}. ${step.title}`,
      "",
      ...step.body,
    ]),
  ].join("\n");
}

module.exports = { renderLearn };
