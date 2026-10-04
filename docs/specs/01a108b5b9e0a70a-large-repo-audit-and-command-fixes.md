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
- R8. A command named `check` (such as `npm run check` or `make check`) is
  categorized as `lint`. `cargo check` stays `build`.

## Acceptance

- Unit tests cover R1, R3, R5-R8.
- `xfeat scan` then `xfeat ci` on hermes-agent exits 0 in well under a
  minute.
- hermes-agent getting-started shows none of the three junk commands from the
  problem statement.
