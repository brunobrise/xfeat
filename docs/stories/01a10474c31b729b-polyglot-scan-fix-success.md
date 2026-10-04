---
date: 2026-10-04
type: success
status: validated
related_specs:
  - ../specs/0019ed76fba2f4da-professional-documentation-workflow.md
evidence_links:
  - ../research/01a103e77ce2751b-multi-repo-documentation-research.md
  - ./01a103e77d697ab1-portfolio-documentation-failures.md
  - ../../professional-docs-polyglot.test.js
  - ../../professional-docs-exports.test.js
  - ../../professional-docs-ownership.test.js
  - ../../lib/professional-docs-manifests.js
  - ../../lib/professional-docs-exports.js
  - ../../lib/professional-docs-writer.js
---

# Polyglot Scan Fix Success

## Context

The portfolio research ran the single-repository `xfeat scan` on a 24-file Rust
workspace and recorded five defects: "No package metadata detected" because
only `package.json` was read, one `crates` component instead of one per crate,
0 public APIs because only JavaScript `export` counted, a README summary cut
mid-sentence, and unconditional writes that could overwrite hand-written
`docs/` pages. The failure story kept this as its only open corrective action.

## Bet

Reusing the portfolio manifest readers and README summarizer would fix package
metadata and component boundaries for every ecosystem at once and keep `scan`
and `portfolio scan` in agreement. A marker line on generated pages would make
ownership checkable without a second state file.

## What Worked

- **Reuse over a second parser.** A small adapter
  ([professional-docs-manifests.js](../../lib/professional-docs-manifests.js))
  maps the shared readers to components, workspace members, and entrypoints.
  Cargo, Python, Go, and Composer metadata came with it.
- **Visibility rules per language.**
  [professional-docs-exports.js](../../lib/professional-docs-exports.js) follows
  each language's own rule: `export`, Rust `pub` without `pub(crate)`, Go
  uppercase identifiers outside `_test.go`, Python module-level names or
  `__all__`.
- **Marker plus legacy status.** Pages start with
  `<!-- xfeat:generated ... -->`. A status written before markers existed still
  vouches for the pages it lists, so upgrades do not freeze old output.
  Deleting the marker hands a page to its authors.
- **Dogfooding on real repositories.** Scratch clones of four local
  repositories found two defects the fixtures missed (see below).

## Evidence

Real run on a scratch clone of `openclaw/crevette`, a Rust workspace with a
Node.js sidecar (98 tracked files):

| Signal                 | Before                                      | After                                                    |
| ---------------------- | ------------------------------------------- | -------------------------------------------------------- |
| Package metadata       | "No package metadata detected."             | "`Cargo.toml` declares a Cargo workspace with 7 members" |
| Components             | `crates` (41 files), sidecar, root, scripts | 7 member crates, sidecar, root, scripts                  |
| Public APIs            | 0                                           | 169                                                      |
| Crate dependency flows | 0                                           | 8, each citing the line that declares the dependency     |
| Hand-written pages     | would be overwritten at generated paths     | skipped and reported in `skipped`                        |

Other real runs: `brunobrise/tf-drift` (Go) reports its module and 61 exported
identifiers; `getzep/graphiti` (Python) splits into 4 packages with 385 public
names; `sherlock-project/sherlock` reads its `pyproject.toml` description.

Tests: [polyglot](../../professional-docs-polyglot.test.js),
[exports](../../professional-docs-exports.test.js), and
[ownership](../../professional-docs-ownership.test.js) suites, plus the
existing npm workspace suite, all pass.

## Defects Found During Delivery

1. **Dotted TOML keys cited line 1.** `protocol.workspace = true` is the common
   Cargo workspace style. The shared TOML parser stored a line only for the full
   dotted path, so 7 of 8 crevette edges cited `Cargo.toml:1`. A wrong
   citation looks valid, which the research ranks as the most dangerous defect
   class. Fixed in `lib/portfolio-toml.js`, which also fixes portfolio
   evidence.
2. **Empty responsibility sentence.** Crates rarely declare `description`, so
   component pages read "Owns No package description detected..". They now
   name the package and cite its name line.
3. **A vacuous regression test.** The first `target/` ignore test used
   `target/debug/build/...`, which the existing `build/` ignore already
   dropped, so it passed with the fix deleted. Deleting the fix and re-running
   exposed it.
4. **Git hook environment leak.** The pre-commit hook runs Jest. Git exports
   `GIT_DIR` to hooks, and the portfolio fixture's `git init` inherited it,
   re-initialized the real repository, and set `core.bare = true` in the shared
   config. Every checkout of the repository stopped working until it was reset.
   The portfolio session made fixture and production git calls drop `GIT_*`
   variables.
5. **Fresh output failing its own audit.** Review found that a package named
   `ledger_tools` is cited in backticks, looks like code to `audit`, and may
   not appear in any source file, so `xfeat ci` failed on a fresh scan. The
   audit now also reads package manifests.
6. **Unanchored Jest ignore.** `testPathIgnorePatterns: ["/\\.claude/"]`
   matched absolute paths, so every test inside an agent worktree was ignored
   and `npm test` failed with "No tests found". Anchoring with `<rootDir>`
   fixed it.

7. **Truncated CLI JSON.** The `scan` JSON embedded every source file's text
   (452 KB for crevette), and the CLI called `process.exit()` before stdout
   drained. On macOS, where pipe writes are asynchronous, `xfeat scan | jq`
   received 512 bytes of invalid JSON, so the new `skipped` list was
   unreachable. The JSON now omits source text, and the exit code is set
   without forcing an exit. Linux CI cannot catch this, because pipes are
   synchronous there.

## Reusable Pattern

- Before adding a reader, check whether `portfolio` already parses the format.
- Run each new regression test once against the unfixed code; if it passes,
  the test is not testing the fix.
- After a change that touches extraction, run `scan` on scratch clones of real
  repositories and read the evidence lines, not only the counts.
- Any test or tool that spawns `git` must drop inherited `GIT_*` variables.
- Test machine-readable CLI output through a real pipe, with output larger than
  the pipe buffer, on macOS as well as Linux.

## Limits

- Public API rules are line-based. A `pub fn` inside a private module or a
  `#[cfg(test)]` block still counts, and Python constants count only when
  written in `UPPER_CASE`.
- Workspace members are read from npm and Cargo only; `go.work` and Python
  workspace tools are not read.
- How-to guides still come only from root `package.json` scripts.

## Follow-Up Check

Re-run `xfeat scan` on a scratch clone of `openclaw/crevette` after any change
to manifest readers, the TOML parser, or export rules. Expect 7 member-crate
components, more than 0 public APIs per crate with `pub` items, and no
dependency flow that cites line 1.
