---
date: 2026-10-04
status: in-progress
owner: TBD
related_specs:
  - ./0019ed76fba2f4da-professional-documentation-workflow.md
  - ./01a103e77d0e706f-portfolio-documentation.md
---

# Large Repository Audit and Command Fixes

## Problem

A dogfood run on `nousresearch/hermes-agent` (commit `36592bb7`, 17,262
files, 12,354 scanned sources, about 133 MB of source text) found three
defects. `scan` and `verify` finished in seconds, but:

1. `xfeat audit` took 546 seconds and `xfeat ci` 530 seconds on 36 Markdown
   files. For every backticked token in the docs (about 354,000), the audit
   ran `String.prototype.includes` over one string holding all source text.
2. `xfeat scan` followed by `xfeat ci` failed with no manual edits. Source
   excerpts that `scan` writes inside fenced code blocks contain Markdown link
   syntax (`[links](...)`, `[report](/home/user/report.md)`), and the audit
   reported them as broken links.
3. `xfeat portfolio` getting-started showed junk as essential commands:
   - the shell builtin `test -n "$identity" || ...` as the test command;
   - a `case` arm, `*) echo "::error::Unexpected digest format..."`, as the
     lint command, because "format" matched the lint rule;
   - a macOS keychain call ending in `>/dev/null` as the run command, because
     `/dev/null` matched `\bdev\b`.

   The root `package.json` script `check` (`npm run --ws check`) was never
   picked, because no category matched `check`.

## Requirements

### Audit

- R1. The stale-reference check gives the same result as before: a token is
  stale when it does not occur as a substring of any source file or manifest.
- R2. Its cost does not grow with source size times token count. Each
  distinct token is looked up once, and the source text is searched once per
  batch of tokens, not once per token.
- R3. Links and code references inside fenced code blocks (backtick and tilde
  fences of three or more characters, closed by a fence of the same character
  at least as long) are not audited. Inline code outside fences is still
  audited for stale references.
- R4. A fresh `scan` on a repository whose source contains Markdown link
  syntax in comments or docstrings is `ci`-clean.

### Portfolio commands

- R5. CI lines starting with the shell builtins `test`, `[`, `[[`, `local`,
  `read`, `shift`, `trap`, `eval`, `return`, `break` or `continue` are
  dropped as noise.
- R6. `case` arms (a line whose first word ends in `)`, such as `*)` or
  `linux|darwin)`) are dropped as noise.
- R7. Categories are matched against command words only: redirection targets
  do not count, so `>/dev/null` is not a `run` command. Other absolute paths
  still count, because `/usr/local/bin/pytest` is a test command.
- R8. A command named `check` (such as `npm run check` or `just check`) is
  categorized as `lint`. `make check` is `test`, because the GNU Coding
  Standards define the `check` target as "Perform self-tests". `cargo check`
  stays `build`.
- R9. Categories come from the command head, not from its arguments. The
  head is the program and the subcommand words that follow it:
  - leading `NAME=value` assignments, redirections, and anything after the
    first `&&`, `||`, `|` or `;` are ignored;
  - wrappers are unwrapped: `bash`, `sh`, `env`, `time`, `xvfb-run`, `npx`,
    `bunx`, `uv run`, `poetry run`, `pipenv run`, `pnpm exec`, interpreters
    running a script (`python`, `node`, `ruby`, `perl`), and `python -m`;
    `bash -c "..."` and `sh -c "..."` categorize the quoted script;
  - a program given as a script path (`scripts/run_tests.sh`, `tool.py`)
    has no subcommands, so its arguments never count;
  - a named program (`npm`, `make`, `docker`, `go`) takes up to two plain
    words as subcommands. Flags before the first subcommand are skipped, and
    the values of `--prefix`, `--filter`, `--workspace`, `-C`, `-f` and
    similar flags are skipped with them. A flag after a subcommand ends the
    head;
  - `_`, `-`, `.`, `/` and `:` separate words inside the head, so
    `run_tests.sh` and `test:unit` are test commands.

  So `bash scripts/install.sh --branch ci-under-test`,
  `docker tag "${IMAGE}:test" ...` and
  `python -m scripts.ci.python_packages pytest==9.1.1` are no longer test
  commands, while `HERMES_TEST_WORKERS=4 scripts/run_tests.sh tests/` and
  `xvfb-run -a npx playwright test` are. This matters beyond getting-started:
  the learning path accepts any `test` command as the answer to "which
  command runs the tests", and a repository without one is reported as a gap.

## Acceptance

- Unit tests cover R1, R3, R5-R9.
- On the 146-repository dogfood corpus (`brunobrise`, `chainsona`,
  `MaikersHQ`), every command whose category changes is reviewed, and no
  repository loses its only correct `test` command.
- `xfeat scan` then `xfeat ci` on hermes-agent exits 0 in well under a
  minute.
- hermes-agent getting-started shows none of the three junk commands from the
  problem statement.
