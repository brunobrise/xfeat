---
date: 2026-10-04
status: implemented
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
- R2. Its cost does not grow with source size times token count. Code
  references are single identifiers (`looksLikeCodeReference`), so one occurs
  in the source exactly when it occurs inside one identifier run
  (`[\w$]+`). The distinct runs are indexed once; each distinct token is
  looked up in the index, and only a token that is not a whole run is
  searched in the joined distinct runs, which are far smaller than the source.
- R3. Links and code references inside fenced code blocks are not audited.
  As in CommonMark, a fence is three or more backticks or tildes indented by
  at most three spaces, optionally inside a blockquote (`> `), with no
  backtick in a backtick fence's info string. It closes on a fence of the same
  character at least as long with nothing after it, or at the end of the
  file. A trailing `\r` is ignored, so CRLF files behave like LF files. Text
  indented by four or more spaces is an indented code block, not a fence, and
  is still audited. Inline code outside fences is still audited.
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
  Standards define the `check` target as "Perform self-tests"; `gradle check`
  is `test` because Gradle's `check` task depends on `test`. Only the exact
  target matches, so `make check-all` is `lint`. `cargo check` stays
  `build`, and `node --check` (a syntax check) is `lint`.
- R9. Categories come from command heads, not from arguments. A line is split
  into stages at `&&`, `||` and `;`. Stages that only prepare the shell
  (`cd`, `export`, `set`, `source`, `echo`, `printf`, `true`) are
  skipped, and commands after a `|` only filter output, so they are skipped
  too. Each remaining stage has a head, and the line takes the first category,
  in rule order, that any stage head matches: `npm ci && npm test` is
  `setup`, `npm run build && npx playwright test` is `test`. A stage head
  is built as follows:
  - leading `NAME=value` and `NAME+=(...)` assignments and redirections are
    dropped; words split on whitespace outside quotes and parentheses, and a
    backslash escapes the next character, so `$(find test-results ...)`
    stays one word;
  - wrappers are unwrapped until the real program leads:
    - prefixes `env`, `time`, `timeout`, `nice`, `nohup`, `stdbuf`,
      `xvfb-run`, `npx`, `bunx` and `uvx`, with their options, durations
      and counts;
    - runners `uv run`, `poetry run`, `pipenv run`, `hatch run`,
      `pdm run`, `pipx run`, `npm exec`, `pnpm exec`, `pnpm dlx`,
      `yarn exec`, `yarn dlx`, `bundle exec`, `coverage run` and
      `yarn workspaces foreach`;
    - interpreters running a script or module (`python`, `node`, `ruby`,
      `perl`, `powershell -File`, `python -m`), skipping options such as
      `--require <module>`, while inline code (`python -c`, `node -e`)
      names no program;
    - shells: `bash -c "..."`, including option clusters such as `-lc` and
      `-euo pipefail -c`, and `pwsh -Command "..."` contribute the heads of
      the quoted script;
    - containers: `docker compose run|exec <service> <command>`,
      `docker exec <container> <command>` and `docker run <image> <command>`
      contribute the inner command. A detached `docker run -d` starts a
      service the job needs, so it stays `docker run`;
  - a program given as a script path (`scripts/run_tests.sh`, `tool.py`) or
    a dotted module has no subcommands, so its arguments never count, except
    `manage.py` and `setup.py`, whose first argument is a subcommand;
  - a named program (`npm`, `make`, `docker`, `go`) takes up to two plain
    words as subcommands. Flags before the first subcommand, and after
    `run`, `run-script` or `exec`, are skipped; the values of flags such as
    `--prefix`, `--filter`, `--workspace`, `--name`, `-C`, `-e` and `-f`
    are skipped with them. Any other flag after a subcommand ends the head.
    `yarn workspace <name>` skips the workspace name, `nx`, `turbo`,
    `lerna` and `cmake` read their task from `-t`/`--target`, and
    `cmake --build <dir>` reads as `cmake build`;
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

- Unit tests cover R1, R3-R9, including every command an independent
  review reproduced as miscategorized.
- On the 146-repository dogfood corpus (`brunobrise`, `chainsona`,
  `MaikersHQ`), every command whose category changes is reviewed, and no
  repository loses its only correct `test` command.
- `xfeat scan` then `xfeat ci` on hermes-agent exits 0 in well under a
  minute.
- hermes-agent getting-started shows none of the three junk commands from the
  problem statement.
