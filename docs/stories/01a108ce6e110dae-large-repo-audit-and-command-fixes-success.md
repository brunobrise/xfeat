---
date: 2026-10-04
type: success
status: validated
related_specs:
  - ../specs/01a108b5b9e0a70a-large-repo-audit-and-command-fixes.md
evidence_links:
  - ../../lib/professional-docs.js
  - ../../lib/portfolio-command-head.js
  - ../../lib/portfolio-commands.js
  - ../../professional-docs.test.js
  - ../../portfolio-commands.test.js
---

# Large Repository Audit and Command Fixes Success

## Context

A dogfood run on `nousresearch/hermes-agent` (commit `36592bb7`, 17,262 files,
12,354 scanned sources, about 133 MB of source text) was the first test on a
repository this size. `scan` took 7 seconds and `verify` 1.5 seconds, but
`audit` took 546 seconds and `ci` 530 seconds. `ci` then failed on two
"broken links" that `scan` itself had written inside fenced source excerpts.
The portfolio getting-started page listed the shell builtin `test -n
"$identity"` as the test command, a `case` arm as the lint command, and a
keychain call ending in `>/dev/null` as the run command.

## Bet

Three small, local changes would make `scan` then `ci` pass on hermes in
under a minute and remove the junk commands, without changing results on
repositories that already worked.

## What Worked

- Code references are single identifiers, so one occurs in the source exactly
  when it occurs inside one identifier run. Indexing the distinct runs once
  replaced one `includes` over 133 MB per backticked token. The proof made a
  fast path safe; a differential run made it trusted.
- Blanking fenced code blocks before auditing, while keeping line breaks,
  fixed the false broken links and kept reported line numbers exact.
- Categorizing commands by their head (program and subcommands) instead of by
  every word fixed a whole class of errors at once: flag values
  (`--branch ci-under-test`), quoted data (`"${IMAGE_NAME}:test"`), version
  pins (`pytest==9.1.1`), redirection targets (`/dev/null`), and later
  pipeline stages no longer decide the category.

## Evidence

| Check                                                                                     | Before                                                                   | After                                                                                        |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `xfeat ci` on hermes-agent                                                                | 530 s, exit 1 (2 broken links)                                           | 11-23 s (warm, cold file cache), exit 0, 636 MB peak                                         |
| Stale references on 400 sampled identifiers (whole words, partial slices, invented names) | 119                                                                      | 119, same tokens in the same order                                                           |
| hermes-agent essential test command                                                       | `test -n "$identity" \|\| ...`                                           | `bash scripts/run_tests.sh tests/scripts/test_fresh_source_install.py -q -j 1`               |
| hermes-agent commands categorized as test (before: with the noise filter only)            | 61, including Docker `:test` image tags, an installer, and a package pin | 43: package `test` scripts and CI test runs, including Playwright and PowerShell smoke tests |

On the 146-repository dogfood corpus (`brunobrise`, `chainsona`, `MaikersHQ`,
2,082 commands) every category change was reviewed: 77 `check`-style scripts
(`type-check`, `check-types`, `style:check`) became `lint`, `make check`
became `test`, `node --check` became `lint`, and the rest were shell
builtins, Docker invocations, shell assignments, and Python heredoc lines that
lost a wrong `test`, `run` or `build` label. No repository lost or gained
its only test command.

## Defects Found During Delivery

- The first version mapped `make check` to `lint`. The GNU Coding Standards
  define the `check` target as "Perform self-tests", so it is `test`; only the
  exact target matches, so `make check-omlx-latest` stays `lint`.
- The corpus diff caught four regressions in the first head-based version:
  `python3 -m unittest discover` lost `test`, `docker compose -f x.yml build`
  stopped at the value flag, `npm run desktop:build+install:macos` stopped at
  `+`, and `make check-*` targets became tests.
- hermes caught two more: whitespace inside `$(find test-results ...)` split
  the substitution so `test-results` read as the program, and `+=` was not
  recognized as an assignment.

## Independent Review

A read-only reviewer that had to reproduce every finding with a script, and
compare it against the main-branch code, confirmed nine defects the suite and
both dogfood runs had missed:

- CRLF files never had their fences skipped, and a fence opener indented four
  or more spaces (an indented code block in CommonMark) hid all prose after
  it, so the audit passed silently on real broken links.
- `bash -lc`, `bash -ec` and `bash -euo pipefail -c` were not unwrapped.
- `python manage.py test` and `python setup.py test` lost `test`: a script
  path never took a subcommand, which would have hit every Django repository.
- `timeout 10m npm test`, `npm run -s test`, `pnpm run -r test`,
  `npm exec -- vitest run`, `uv run --python 3.12 pytest`,
  `yarn workspace @acme/web test`, `nx affected -t test`,
  `docker compose run --rm web pytest`, `coverage run -m pytest` and
  `sh -c "cd web && npm test"` lost `test`.
- Escaped quotes inside `bash -c "..."` broke tokenizing, and `./gradlew
check` and `env -u FOO make check` were miscategorized.

All nine are fixed with a test per reproduced command. Re-running the
reviewer's 159 probe commands then showed no command that the main branch
categorized as `test` and the branch did not. A last hermes pass caught one
more class the review did not: `npm run build && npx playwright test` read
only its first stage, so every stage is now read and the first rule any stage
matches wins, which keeps `npm ci && npm test` as `setup` as before.

Lesson: the corpus diff only compares against what the corpus contains.
Neither corpus had a Django, Nx or docker-compose test step, so it could not
catch those losses; an adversarial reviewer generating realistic commands per
ecosystem could.

## Reusable Pattern

- When a check is slow, look for a property of the inputs that makes a cheap
  index exact, prove it, then confirm with a differential run against the old
  code on real data.
- When a categorizer misfires on arguments, change what it reads, not the
  word lists: a head-based reader fixes classes of errors that keyword
  additions only move around.
- Diff every category on a large real corpus before and after, and read each
  change. Unit tests written from the bug report missed six of the defects
  above.
- Then ask an independent reviewer for per-ecosystem probes the corpus lacks,
  and require a reproduction for every finding.

## Limits

- The essential test pick is still the first test command in CI file order,
  so hermes shows a run of one test file rather than the bare
  `scripts/run_tests.sh`.
- Scripts under `tests/` count as tests by their path, including helpers such
  as `node tests/install/e2e-assets/bundle-plan.mjs`.
- `python -m <module>` is no longer `run` unless the module name says so.
- Heads are heuristics over shell text. Unknown wrappers or unknown flags that
  take a value before a subcommand can still shift the head; the review's
  probe list is the regression set to extend when one is found.
- Generated pages on hermes are still too large to read (a 7 MB component
  page, a 29 MB claims reference). Size caps are a separate design change.
- Portfolio file listing descends into nested git checkouts such as
  `.claude/worktrees/*`, crediting their commands to the parent repository.
  That predates this change and is tracked separately.

## Follow-Up Check

After any change to `lib/portfolio-command-head.js` or the category rules,
rerun the corpus category diff (portfolio scan with `--from` on each corpus
folder, then compare `repos[].commands[].category` by `cwd` and `command`)
and read every change. After any change to the audit, rerun `xfeat ci` on a
scratch clone of hermes-agent and expect exit 0 well under a minute.
