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
green for all of them. The dogfood setup also exposed two older defects in
`portfolio init`, the paired agent evaluation exposed a biased grader, and an
independent review before merge found 14 more. All are fixed on
`feat/block-model-curriculum`.

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
9. Dogfood setup: `portfolio init --manifest <path>` failed with ENOENT when
   the folder did not exist. Pre-existing. Fixed: `init` creates the folder.
10. Review of that fix: `init --out portfolio-out --manifest nested/x.json`
    stored `portfolio-out` as written, which later resolved against the
    manifest folder, while every other `--out` is relative to the working
    folder. Pre-existing. Fixed: `init` stores `--out` relative to the
    manifest, like repository paths.
11. Paired agent evaluation: the agent without docs scored 9/12, but all three
    "wrong" answers were right. It answered `npm test` and `pnpm test`; the
    grader expected xfeat's wording, `npm run test` and `pnpm run test`. The
    agent with docs copied xfeat's wording and scored 12/12. The grader was
    measuring vocabulary overlap with the docs, not knowledge. Fixed:
    equivalent npm, pnpm, and yarn test invocations compare equal, and
    `corepack` is ignored; `bun test` stays distinct. Both arms now score 12/12.

## Independent Review Before Merge

A read-only reviewer reproduced each finding with a script before reporting
it. All 14 are fixed:

| #   | Severity | Defect                                                                                                                    | Fix                                                                                            |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | high     | "Which repositories does X depend on?" omitted a dependency matched by package name, so a correct reader was graded wrong | Skip dependency, file, provider, and impact checks that a name match or ambiguous name touches |
| 2   | medium   | The change step said no repository depends on the focus while a name-matched dependent existed                            | Re-test list uses every dependency xfeat saw                                                   |
| 3   | medium   | A dependency declared in two files kept only the first, so the other file was graded wrong                                | Edges record `alsoDeclaredIn`; the file question is skipped for them                           |
| 4   | medium   | `verify` passed after a new dependency made recorded answers incomplete                                                   | `verify` recomputes the checks and fails on `stale-check`                                      |
| 5   | medium   | Run and Change steps dropped the test command's folder                                                                    | Steps name `repo/folder`                                                                       |
| 6   | medium   | A program name that is not a string crashed the whole scan                                                                | Only string names are used                                                                     |
| 7   | low      | `--min-score=` with an empty value disabled the gate                                                                      | Empty values are rejected                                                                      |
| 8   | low      | "No checks" text claimed facts were missing when they were only filtered                                                  | Reworded                                                                                       |
| 9   | low      | Large answer and re-test lists broke the 25-word rule                                                                     | Lists show ten names and point to `checks.json`                                                |
| 10  | low      | A malformed `checks.json` crashed `verify` or produced an unhelpful error                                                 | Validated; errors name the file                                                                |
| 11  | low      | A file path starting with a folder named like the repository accepted a wrong answer                                      | The repository prefix is stripped from the answer only                                         |
| 12  | low      | Text promised a provider line, a clone, and a link that were not always there                                             | Statements depend on the evidence present                                                      |
| 13  | low      | "Which repository provides `github.com/acme/ledger`?" gave its answer away                                                | Module paths ending in the repository name are skipped                                         |
| 14  | low      | An edited manifest did not name the owner checks it affects                                                               | `changed-manifest` lists them                                                                  |

Finding 2 repeated a defect this story already claimed to have fixed (timeline
step 2). The first fix replaced a wrong sentence with a narrower wrong
sentence, because it reused the declared-only edge list.

The fix for finding 4 introduced a defect of its own, caught by self-review
before merge: `verify` rebuilt the selection from the manifest alone, so a
scan that combined `--manifest` with extra paths reported every check of the
extra repositories as stale. The rebuild now always passes the stored
repository paths as well, and a test covers the combined case.

## Multi-Hop Follow-Up

Adding multi-hop questions and repeating the evaluation surfaced six more
problems. None was caught by the fixture suite.

| #   | Defect                                                                                                                                                                                                      | Found by                                       | Fix                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | CI command extraction kept shell conditions (`test -f dist/app`), variable assignments, multi-line message strings, and Python and Node scripts embedded in heredocs; some were classified as test commands | Dogfood on 75 repositories                     | Heredoc bodies, multi-line strings, the `test` builtin, and bare assignments are dropped; 537 lines on 410 repositories, no real command lost |
| 2   | The first heredoc rule treated `echo "log<<EOF"` as a heredoc and swallowed every command after it                                                                                                          | Diff of extracted commands on 410 repositories | `<<` inside a quoted string no longer opens a heredoc                                                                                         |
| 3   | Test-command joins were guessable: answering `npm run test` to every one was right 6 times out of 6                                                                                                         | A guess baseline written for the evaluation    | `grade` reports a baseline; sibling joins, which cannot be guessed, were added                                                                |
| 4   | The first baseline leaked answers: a question that was the only one of its kind was "guessed" from its own answer                                                                                           | Inspecting the baseline answers                | The baseline leaves the question itself out                                                                                                   |
| 5   | The grader drifted again: the new join kind skipped the `npm test` = `npm run test` rule and case rules, so a correct agent scored 10/12                                                                    | Grading the first repositories-only run        | Normalization follows what the answer names, read from the check's format                                                                     |
| 6   | The local corpora cannot test dependency multi-hop: 396 repositories hold 2 declared cross-repository edges and no chain                                                                                    | Scanning every local repository                | Transitive questions are tested on fixtures; the limit is stated in the spec and the success story                                            |

Defect 5 is the third grading bias in this feature, and the second in the same
rule. Each time, a correct answer in different words was graded wrong, and each
time the bias favoured the arm that read xfeat's own wording.

### Second Independent Review

A second read-only reviewer reproduced 14 findings on the multi-hop branch
before merge. One (the grader drift above) was already fixed. The other 13 are
fixed with tests:

| #   | Severity | Defect                                                                                                                     | Fix                                                                                                  |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | high     | A `"` inside single quotes (`tr -d '"'`, `sed 's/"//g'`) opened a fake string and dropped every later command in the block | CI blocks are read by a small quote-aware scanner that tracks single and double quotes and escapes   |
| 2   | high     | `RUSTFLAGS="-D warnings" cargo test` and other env prefixes with quoted values were dropped as bare assignments            | A line is noise only when nothing but assignments remains after reading each value as one shell word |
| 4   | medium   | The baseline guessed a question from join copies of its own answer                                                         | Every question about the same repository is left out of the guess                                    |
| 5   | medium   | The baseline split votes between `npm test` and `npm run test` and never guessed a multi-value set                         | Votes are normalized like grading, one per repository, and set questions are guessed as whole sets   |
| 6   | medium   | Joins crowded the focus repository's own test question out of the Run step and repeated a shown owner in Orient            | Single lookups come first, one per kind, and a join is dropped when its single-hop twin is shown     |
| 7   | medium   | A scoped npm package's string `bin` was named `@acme/fmt`; npm installs it as `fmt`                                        | The scope is removed from string `bin` names                                                         |
| 8   | low-med  | A package-name shortcut made a one-hop dependency look two hops away and produced a transitive question                    | Hops are measured over every dependency xfeat saw                                                    |
| 9   | low      | Here-strings, `$((1<<N))`, comments mentioning `<<EOF`, and `<<\EOF` started fake heredocs; `bash <<EOF` bodies were lost  | The scanner ignores those forms and keeps commands fed to a shell                                    |
| 10  | low      | `test/run-integration.sh` and `test.sh` were dropped as the `test` builtin                                                 | Only `test` followed by a space or the end of the line is the builtin                                |
| 11  | low      | A quote opened on a backslash-continued line glued the next command to it                                                  | Continuations and open quotes join into one logical line                                             |
| 12  | low      | `verify` failed after an xfeat upgrade because the new `hops` field changed every check                                    | Only a changed question, answer, or citation blocks; metadata changes are a warning                  |
| 13  | low      | A join relying on a manifest-declared owner cited only the program line                                                    | The answer also cites the portfolio manifest                                                         |
| 14  | low      | The spec said "longest path" where the code uses the longest shortest chain, and did not say cycles exclude the subject    | Spec reworded                                                                                        |

Findings 1, 2, 9, and 10 were regressions introduced by this branch's own fix
for junk CI commands, caught before merge. Re-extracting commands for all 410
local repositories after the scanner rewrite removed 617 lines, all of them
assignments, the `test` builtin, embedded scripts and JSON, or heredoc bodies,
and recovered complete multi-line commands such as `mypy ... | sed -E '...'`.

### STE-Lite Extension

Extending the writing rules to every generated page surfaced four problems.

| #   | Problem                                                                                                                                               | Found by                                | Fix                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | The first real-data lint read every `docs/**/*.md`, including a repository's own design notes, and reported 1,740 findings that were not xfeat's      | The gstack findings were human prose    | The lint covers only pages with the `xfeat:generated` marker; the page test had the same gap, hidden by a short fixture ADR |
| 2   | A step for a repository without a git remote had two sentences, and the scan overview wrote an eight-sentence README summary as xfeat's own paragraph | Real data; the fixture had neither case | One-sentence step; README summaries render as blockquotes                                                                   |
| 3   | The lint split sentences at colons, so "(evidence: `x`)" counted as a second instruction                                                              | Template review                         | Only `.`, `?`, and `!` end a sentence for the one-instruction rule                                                          |
| 4   | A previous round wrote "Set up" into the Run step goal, a phrasal verb that rule 9.3 forbids and no test can see                                      | Manual review                           | Replaced with "Prepare"                                                                                                     |

An independent review of the STE-lite branch then found nine more problems.
The first claim, "every generated page follows the rules", was false before
these fixes.

| #   | Problem                                                                                                                            | Fix                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | The lint counted words per colon chunk, so a 30-word change step with a list of dependents passed                                  | Only `.`, `?`, and `!` end a sentence; the dependents moved to a nested list of at most ten names |
| 2   | Package and portfolio descriptions were written into xfeat's own sentences, so an author's semicolon broke the rules               | Both render as blockquotes under a short cited sentence                                           |
| 3   | A rewritten how-to step told readers to install dependencies only when the repository had none                                     | "Run `npm install` if you did not install the dependencies."                                      |
| 4   | The scan overview said "as its manifest describes it" but cited the README title, and added a period the source did not have       | Evidence comes from the same source as the quote, and the quote is verbatim                       |
| 5   | Untested branches still broke rules: dependency cycles, the no-checks page, subfolder manifests, large workspaces, and `llms.txt`  | Templates rewritten, member lists capped at ten, and every branch added to the page tests         |
| 6   | `gaps.md` lost the README's deprecation advice, and the new `quote` field was undocumented                                         | The table shows the quote after the message, and the portfolio spec documents the field           |
| 7   | A README heading or fence quoted as a deprecation line rendered as a heading or code block inside the Gaps list                    | Leading Markdown block markers are removed from the quote                                         |
| 8   | The lint missed irregular participles, "by" fragments, continued steps, `1)` steps, and some contractions, and flagged "read-only" | The patterns cover them, with tests for each case and for the false positives                     |
| 9   | The README, spec, and story claimed more than the code did                                                                         | Each claim now names its test coverage and the exact edits xfeat makes to quoted text             |

Problem 3 is the reverse of the feature's goal: a rewrite for style changed the
instruction's meaning, and no lint can see that.

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
| Create the manifest folder in `portfolio init`    | TBD   | done   | [portfolio-docs.test.js](../../portfolio-docs.test.js)                 |
| Store `init --out` relative to the manifest       | TBD   | done   | [portfolio-docs.test.js](../../portfolio-docs.test.js)                 |
| Run a paired agent evaluation on a real portfolio | TBD   | done   | [success story](./01a10804fd337dd6-portfolio-learning-path-success.md) |
| Grade equivalent test invocations as equal        | TBD   | done   | [portfolio-grade.test.js](../../portfolio-grade.test.js)               |
| Add multi-hop questions and repeat each arm 3x    | TBD   | open   | [success story](./01a10804fd337dd6-portfolio-learning-path-success.md) |

## Prevention Guidance

- When rewriting a sentence for style, read the new sentence for meaning
  before anything else. A lint checks form, not whether the instruction is
  still true.
- Never splice source text into a template sentence. Quote it as a block under
  a short sentence that cites it.
- For any generated question, ask whether a reader who does not know the code
  could answer it from the question alone. If yes, do not generate it.
- An answer built from a filtered subset of facts must either say so in the
  question or be skipped when the filter removed something. "Declared" in
  xfeat's vocabulary is not what a reader means by "declared".
- When a statement is fixed, check every input it reads, not only its wording.
- Have an independent, read-only reviewer reproduce findings before merging a
  feature that grades people or agents.
- Build "correct" answer files the way a reader answers: one value for
  single-answer questions, a list only for list questions.
- Before comparing arms, grade each arm's "wrong" answers by hand. A grader
  that keys on the docs' own wording rewards copying, not knowing.
- Read one rendered page per feature before committing, and check every
  sentence for a claim xfeat cannot verify.
- Re-run dogfood on the `brunobrise/` folder: it is the selection with a
  declared cross-repository edge.
- Report the guess baseline beside every evaluation score. A question that a
  reader can answer without reading cannot show understanding.
- When adding a check kind, grade one correct answer in different words, such
  as `npm test` for `npm run test`, before trusting any score.
- When changing command extraction, diff the extracted commands on the whole
  local tree before and after, and read every removed line that had a
  category.

## Follow-Up Validation

After any change to checks or the path, re-run the dogfood evaluation script
on `brunobrise/` and `MaikersHQ/`: correct answers must grade 1.0, empty
answers 0, `verify` must report 0 findings, and `learn.md` must have 0 long
sentences.
