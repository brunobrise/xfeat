---
date: 2026-10-04
type: success
status: validated
related_specs:
  - ../specs/01a10804fd3272c3-portfolio-learning-path-and-checks.md
evidence_links:
  - ../research/01a10804fd3079f7-explorable-docs-curriculum-research.md
  - ../../portfolio-checks.test.js
  - ../../portfolio-learn.test.js
  - ../../portfolio-curriculum.test.js
  - ../../portfolio-grade.test.js
---

# Portfolio Learning Path and Checks Success

## Context

The request asked for documentation that is explorable, mappable, and usable
as a curriculum for people and AI agents, and whether generated prose should
follow ASD-STE100. The target interface was a zoomable block map with eight
relation types and a prose side panel.

## Bet

Research first, then build the part with the strongest evidence. The research
favoured checks over maps: practice testing has robust effects for people,
explorable maps as primary navigation left learners lost, and a task-based
evaluation was the open quality metric for agents. The bet was that checks
computed from cited facts can teach, evaluate, and stay fresh at the same time.

## What Worked

- **Checks inherit verification.** Every check cites claim ids that `verify`
  already re-reads. Changing one cited line in a fixture made `verify` fail and
  name `dependencies:billing-api`, `dependency-file:billing-api->ledger`, and
  `impact:ledger` as stale. No new freshness machinery was needed.
- **One grader serves people and agents.** `portfolio questions` prints the
  checks without answers; `portfolio grade` scores answers deterministically,
  with no model as judge.
- **Short-sentence rules enforced by tests, not prompts.** Generated text comes
  from templates, so a test that fails on sentences over 25 words keeps
  `learn.md` compliant. Every dogfood `learn.md` had 0 long sentences.
- **Rejecting ASD-STE100 was cheap and well grounded.** Its approved dictionary
  bans `run`, `call`, `return`, and `create`, its licence forbids embedding,
  and an LLM told to write strict STE lost 47% of code facts in a small test.

## Evidence

Dogfood runs on local repository folders, after the fixes in the
[failure story](./01a10804fd347d07-portfolio-learning-path-failures.md):

| Selection     | Repositories | Edges | Checks | Steps | Correct answers | Empty answers | Verify     |
| ------------- | ------------ | ----- | ------ | ----- | --------------- | ------------- | ---------- |
| `brunobrise/` | 75           | 1     | 61     | 5     | 1.0             | 0             | 0 findings |
| `MaikersHQ/`  | 30           | 0     | 18     | 3     | 1.0             | 0             | 0 findings |
| `chainsona/`  | 42           | 0     | 24     | 3     | 1.0             | 0             | 0 findings |

- The 42-repository scan took 4.59 seconds with about 109 MB peak memory.
- "Correct answers" means one value per single-answer question and the full
  list per list question, the way a reader answers.
- Check kinds on the 75-repository set: 37 test command, 20 program, 1 owner,
  1 dependency list, 1 dependency file, 1 impact. The folder held 74
  repositories when the first runs were made; one was added during the session.
- `verify` on the 75-repository set took 15.4 seconds and about 273 MB, because
  it rebuilds the model to catch stale answers.
- Full suite: 198 tests pass.

## Paired Agent Evaluation

One run per arm on the 74-repository set, same model (Claude Sonnet), same 12
questions sampled across every check kind, same rules. Arm A saw only the
repositories. Arm B also had the generated docs, without `checks.json` and
`learn.md`, which contain the answers.

| Arm                   | Score after grader fix | Score before fix | Tool calls | Tokens | Wall time |
| --------------------- | ---------------------- | ---------------- | ---------- | ------ | --------- |
| A: repositories       | 12/12                  | 9/12             | 36         | 84,021 | 445 s     |
| B: repositories, docs | 12/12                  | 12/12            | 19         | 79,459 | 56 s      |

- **Accuracy did not differ.** Both arms answered every question. The first
  grading showed 9/12 for arm A only because the grader demanded xfeat's
  wording (`npm run test`) and rejected the equivalent `npm test`. That bias
  favoured the arm that read the docs. The grader now treats equivalent test
  invocations as equal; see the
  [failure story](./01a10804fd347d07-portfolio-learning-path-failures.md).
- **The docs cut effort.** Arm B used 47% fewer tool calls and finished about
  8 times faster, with 5% fewer tokens. This matches the research: context
  files changed efficiency more than task success.
- **The questions hit a ceiling.** Lookups with a named repository are easy to
  answer by searching. They cannot show an accuracy gain.
- **Limits.** One run per arm, 12 questions, one model. Wall time is the
  least reliable number: arm A handed back its answers at 445 s, but its
  background work kept running until 864 s. Treat the result as indicative.
- **The sample was taken before the review fixes.** The review later removed
  some dependency questions as incomplete; none of the 12 sampled questions
  were affected.

## Multi-Hop Evaluation, Three Runs Per Arm

The follow-up added questions that join two facts and repeated each arm three
times on the 75-repository set, with the same model (Claude Sonnet), rules,
and 12 questions for every run. Six questions were two-hop joins: three
"which other programs does the repository that provides program X ship"
(answer: a set of names) and three "which command runs the tests of the
repository that provides program X". Six were single-hop questions chosen so
none revealed a join's first hop. All six runs ran at the same time.

| Arm                        | Score (each run) | Multi-hop | Tool calls, mean (range) | Tokens, mean (range)     | Wall time, mean (range) |
| -------------------------- | ---------------- | --------- | ------------------------ | ------------------------ | ----------------------- |
| Guess baseline, no reading | 4/12             | 3/6       | 0                        | 0                        | 0                       |
| A: repositories            | 12, 12, 12       | 6/6       | 47.3 (42-51)             | 103,025 (90,026-116,115) | 191 s (125-283)         |
| B: repositories, docs      | 12, 12, 12       | 6/6       | 30.7 (25-38)             | 94,466 (90,530-99,364)   | 95 s (78-109)           |

- **Accuracy is at the ceiling for joins too.** Every run answered every
  question, including the sibling joins that cannot be guessed. Each hop is
  one search for a capable agent, so a two-hop join is still easy.
- **The docs reliably cut effort.** Arm B used 35% fewer tool calls and took
  about half the time, and the ranges do not overlap across three runs. The
  8% token saving lies within the spread, so it is not shown.
- **The guess baseline mattered.** Answering `npm run test` to every
  test-command join scored 3 of 3 without reading anything. Without the
  baseline, those questions would have looked like evidence of understanding.
- **The grader drifted again.** Arm A first scored 10/12 because the new join
  kind skipped the rule that `npm test` equals `npm run test`. Grading now
  follows what an answer names, so new kinds inherit the rules; see the
  [failure story](./01a10804fd347d07-portfolio-learning-path-failures.md).
- **Limits.** One model, 12 questions, one portfolio, concurrent runs. One
  arm A run reported background work still running at hand-back, so its
  283 s may include time after it answered; the other arm A runs also took
  longer than every arm B run. The
  questions that would test accuracy, such as closures over several dependency
  edges, need a portfolio with declared chains. None of 396 local repositories
  has one, so transitive-dependency questions are tested on fixtures only.

The kill criterion was "drop the learning path if harder questions show no
accuracy or cost gain". The cost gain held across three runs per arm, so the
feature stays. An accuracy gain remains unshown.

## Reusable Pattern

When a feature needs to teach or evaluate, derive questions from the same
evidence the verifier already checks, and make the grader deterministic. Then
freshness, teaching, and measurement share one source of truth.

## Limits

- Most checks are fact lookups (test commands, program owners). They test
  where facts live, not why the system is shaped the way it is. The Trace
  explanation prompt is the only "why" item, and it is ungraded.
- Coverage follows declared metadata. Owners were declared for 1 of 74
  repositories, so orientation checks are thin on real portfolios.
- Two paired evaluations, the second with three runs per arm and two-hop
  joins, show lower effort, not higher accuracy. There is no evidence yet that
  the generated docs raise agent scores.
- Quoted README sentences in repository pages exceed 25 words in 11 places.
  They are cited source text, so xfeat does not rewrite them; the sentence
  rule applies to generated text only.

## Follow-Up Check

The original criterion was to keep the feature only if the docs raise the
score at similar cost. The first run met a weaker version: equal score at
lower cost. The criterion was stated before the questions were known to hit a
ceiling, so it is revised rather than ignored:

- Keep the checks, path, and grader: the grader already found a bias in its
  own scoring and measured a cost difference, which is the evaluation the
  portfolio research asked for.
- Add questions that need several hops, such as impact through two or more
  edges, on a portfolio with more declared edges than `brunobrise/`. Done for
  joins; see the multi-hop evaluation above.
- Repeat each arm at least three times and report the spread. Done. Drop the
  learning path if harder questions show no accuracy or cost gain. The cost
  gain held.
- Next: run the same protocol on a portfolio with declared dependency chains,
  where closure questions cannot be answered with one search per hop, and
  report the guess baseline beside every score.
