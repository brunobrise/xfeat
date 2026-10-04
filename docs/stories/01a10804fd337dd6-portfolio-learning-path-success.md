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
| `brunobrise/` | 74           | 1     | 60     | 5     | 1.0             | 0             | 0 findings |
| `MaikersHQ/`  | 30           | 0     | 18     | 3     | 1.0             | 0             | 0 findings |
| `chainsona/`  | 42           | 0     | 24     | 3     | 1.0             | 0             | 0 findings |

- The 42-repository scan took 4.59 seconds with about 109 MB peak memory.
- "Correct answers" means one value per single-answer question and the full
  list per list question, the way a reader answers.
- Check kinds on the 74-repository set: 36 test command, 20 program, 1 owner,
  1 dependency list, 1 dependency file, 1 impact.
- Full suite: 179 tests pass.

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
- The paired agent evaluation the grader enables has not been run. There is no
  evidence yet that the generated docs raise agent scores.
- Quoted README sentences in repository pages exceed 25 words in 11 places.
  They are cited source text, so xfeat does not rewrite them; the sentence
  rule applies to generated text only.

## Follow-Up Check

Run `portfolio questions` for the 74-repository set, answer once with an agent
that sees only the repositories and once with the generated docs, and grade
both. Keep the feature only if the docs raise the score at similar cost.
