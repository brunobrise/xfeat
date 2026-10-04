---
date: 2026-10-04
type: failure
status: validated
related_specs:
  - ../specs/01a10804fd3272c3-portfolio-learning-path-and-checks.md
evidence_links:
  - ../../portfolio-checks.test.js
  - ../../portfolio-learn.test.js
  - ../../portfolio-grade.test.js
---

# Portfolio Learning Path Failures

## Summary

Building the learning path and checks surfaced seven defects. Three were found
by reading the rendered fixture page, three only by running on real
repositories, and one in the evaluation harness itself. The fixture tests were
green for all of them. All but one are fixed on `feat/block-model-curriculum`.

## Impact

- On the 74-repository set, the focus repository had a declared edge but no
  test command, so the path never ran a test and the change step disappeared.
  That step carries the strongest evidence for newcomers.
- 5 of 25 program questions gave their answer away, for example "Which
  repository provides the program `ai4a`?" answered by `ai4a`. A question
  that contains its answer cannot tell a reader who knows the code from one
  who does not.
- Grading the expected answers scored 0.5667 instead of 1. The harness passed
  every valid answer as a list; the grader correctly rejects hedged lists for
  one-of questions. The end-to-end test built answers the same way and passed
  only because each fixture repository has one test command.

## Timeline

1. Fixture review: the Run and Impact steps showed checks about unrelated
   repositories (`billing-web`, `ui-kit`, `platform-workflows`). Fixed: only
   orientation fills up with other repositories.
2. Fixture review: the change step said "no other tests are needed". xfeat
   only sees declared dependencies, so this overclaimed. Fixed: "No selected
   repository declares a dependency on X."
3. Fixture review: "N more paths are listed in dependencies.md" pointed at a
   page that does not list paths. Fixed: the remaining repositories are in the
   impact check answer.
4. Dogfood: the `chainsona/` folder produced 0 edges because `legi-france` is
   no longer a git repository there. The original 74-repository set lives in
   `brunobrise/`. Corpus drift, not a regression.
5. Dogfood: focus without tests. Fixed: a declared test command now ranks
   above edge count, and Trace falls back to any declared edge.
6. Dogfood: giveaway program questions. Fixed: program names equal to the
   repository name are skipped.
7. Dogfood: "xfeat copied these commands" appeared when no command was listed.
   Fixed: the note only appears with a command.
8. Evaluation: the 0.5667 score. Fixed the test to give one value for one-of
   questions, added a test that a hedged list is wrong, and documented the
   rule in the README and spec.
9. Open: `portfolio init --manifest <path>` fails with ENOENT when the folder
   does not exist. Pre-existing; not fixed in this branch.

## Contributing Factors

- The fixture was built for the portfolio spec, where every repository has at
  most one test command and program names differ from repository names.
- Tests asserted structure (headings, counts, citations), not whether a
  question is worth asking or whether a sentence is true.
- The harness that computed "correct" answers reused the grader's data shape
  instead of answering like a reader.

## What Reduced Impact

- Rendering the fixture page and reading it before committing caught three
  defects that no assertion covered.
- Deterministic output let each fix be compared run to run.
- Citations made the giveaway and off-subject checks easy to spot.

## Corrective Actions

| Action                                            | Owner | Status | Evidence                                                               |
| ------------------------------------------------- | ----- | ------ | ---------------------------------------------------------------------- |
| Prefer a testable focus; trace any edge           | TBD   | done   | [portfolio-learn.test.js](../../portfolio-learn.test.js)               |
| Skip giveaway program questions                   | TBD   | done   | [portfolio-checks.test.js](../../portfolio-checks.test.js)             |
| Answer one-of questions with one value in tests   | TBD   | done   | [portfolio-grade.test.js](../../portfolio-grade.test.js)               |
| Create the manifest folder in `portfolio init`    | TBD   | open   | this story, timeline step 9                                            |
| Run a paired agent evaluation on a real portfolio | TBD   | open   | [success story](./01a10804fd337dd6-portfolio-learning-path-success.md) |

## Prevention Guidance

- For any generated question, ask whether a reader who does not know the code
  could answer it from the question alone. If yes, do not generate it.
- Build "correct" answer files the way a reader answers: one value for
  single-answer questions, a list only for list questions.
- Read one rendered page per feature before committing, and check every
  sentence for a claim xfeat cannot verify.
- Re-run dogfood on the `brunobrise/` folder: it is the selection with a
  declared cross-repository edge.

## Follow-Up Validation

After any change to checks or the path, re-run the dogfood evaluation script
on `brunobrise/` and `MaikersHQ/`: correct answers must grade 1.0, empty
answers 0, `verify` must report 0 findings, and `learn.md` must have 0 long
sentences.
