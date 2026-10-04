---
date: 2026-10-04
type: failure
status: validated
related_specs:
  - ../specs/01a103e77d0e706f-portfolio-documentation.md
evidence_links:
  - ../research/01a103e77ce2751b-multi-repo-documentation-research.md
  - ../../portfolio-docs.test.js
  - ../../portfolio-edges.test.js
  - ../../portfolio-commands.test.js
---

# Portfolio Documentation Failures

## Summary

Building `xfeat portfolio` surfaced nine defects. Five were caught by focused
tests during development. Four only appeared when the command ran on 74 real
local repositories. All nine are fixed on the `feat/multi-repo-docs` branch. The
real-repository run is the reason the fixes exist: the fixture suite was green
while the output still missed a real dependency and filled onboarding pages
with CI noise.

A pre-merge review with three independent reviewers and a parallel session
found more than a dozen further defects. Two were destructive: `scan` could
write or delete outside its output folder, and the test fixture corrupted the
shared repository configuration when it ran inside a git hook. Both are fixed
and covered by regression tests.

## Impact

- One real cross-repository dependency was missing from the landscape. The
  first real run reported 0 edges; the true number was 1.
- 59 of 310 extracted CI commands (19%) were workflow expressions, shell
  fragments, or toolchain installers that a developer cannot run.
- Onboarding pages grew to 958 lines for 74 repositories, and one shared
  dependency cell listed about 30 repositories with full links.
- A purpose statement cited the wrong line, which looked like valid evidence.
  Research shows citations raise trust even when they are wrong, so this is
  the most dangerous defect class.
- The pre-commit audit gate failed on `main` before any change, blocking every
  commit.
- Fixture tests running inside a linked worktree's pre-commit hook set
  `core.bare = true` in the shared `.git/config`. Every checkout then failed
  with "fatal: this operation must be run in a work tree" until the value was
  restored. Fixture files were also staged in the enclosing repository index.
  No commit was affected.
- A symlinked output subfolder, or a stale `portfolio.json`, could make `scan`
  delete files outside the output folder, including hand-written files.

## Timeline

1. Pre-commit `npm audit --audit-level=critical` failed on a new `tar`
   advisory bundled in the `npm@11.16.0` override. Fixed by moving the override
   to `npm@11.21.0`, which keeps the same major version and ships `tar ^7.5.22`.
2. Git test: a plain folder inside another repository reported the parent
   repository's HEAD and remote. Fixed by scoping git metadata with
   `--show-prefix` and path-limited `status`, `log`, and `ls-files`.
3. Model test: a purpose taken from `pyproject.toml` cited the package name
   line instead of the description line. Fixed by recording
   `descriptionLine` in every manifest reader.
4. Spec diagram: the label `integrations/<a>--<b>.md` rendered `<b>` as bold
   PlantUML markup. Fixed by using `{a}--{b}` in labels.
5. Full suite: one run failed under parallel workers because git-heavy tests
   exceeded the default 5 second Jest timeout. Fixed with a 30 second timeout
   in suites that create real repositories.
6. Development: two scripted text replacements matched nothing after Prettier
   reflowed the target lines, and silently did nothing. Assertions caught both.
7. Dogfood run 1: 0 edges. `legi-france/.gitmodules` declares
   `url = ../legi.py`, a relative URL that git resolves against the
   superproject remote. Fixed by resolving relative submodule URLs against the
   remote, or against the folder when there is no remote.
8. Dogfood run 1: CI commands from `release.yml` included `${{ }}`
   expressions, `if`/`fi` fragments, `curl ... | sh` installers, and a
   `--output-format=json` flag that matched the lint category. Fixed by
   skipping release, publish, and deploy workflows for commands, dropping
   expression and fragment lines, and categorizing with flags removed.
9. Dogfood run 1: repository pages repeated workspace packages under both
   Modules and Interfaces, showed crate binaries without their crate folder,
   and rendered empty Description columns. Shared dependencies listed every
   usage in one cell. Fixed by listing packages once, joining binary paths with
   the manifest folder, omitting empty columns, grouping usages by version,
   and showing one command per purpose in `getting-started.md`.
10. Pre-merge review: `scan` followed symlinks when writing and deleting, and
    created the output folder before checking whether it resolved into a member
    repository. Fixed with real-path containment checked before the first
    `mkdir`, refusal to write through symlinks, and deletion limited to files
    carrying the xfeat generator marker.
11. Pre-merge review: concurrent test runs in one checkout shared fixture
    folders inside the repository, so a failed `git init` let `git add` reach
    the enclosing repository. Inside a linked worktree's pre-commit hook the
    inherited `GIT_DIR` made the fixture's `git init` rewrite the shared config
    as bare. Reproduced on a throwaway repository, then fixed with fixtures in
    `os.tmpdir()`, every `GIT_*` variable removed from test git commands, a
    toplevel guard, and repository-locating variables removed from production
    git calls. Jest and ESLint now skip agent worktrees, anchored to
    `<rootDir>` so tests still run inside a worktree.
12. Pre-merge review: the TOML reader accepted `__proto__` keys (prototype
    pollution); one malformed manifest could abort the scan; npm git specs
    carried tokens into dependency versions; manifests sorted by locale; and
    dotted keys such as `serde.workspace = true` cited line 1. The last one was
    found by the parallel session's dogfood run on a real Cargo workspace.
13. Pre-merge review: Go requirements matched the first module path instead of
    the longest; shared remotes and module paths resolved silently; path
    dependencies cited the wrong provider manifest; evidence in files over
    1 MB always verified as fresh; edits to `xfeat.portfolio.json` were
    invisible to `verify`; link paths were not encoded, and a `%` crashed `ci`;
    `landscape.md` embedded an SVG even after a failed render; `llms.txt`
    carried prose; and CLI options a command ignores were accepted silently.
14. Pre-merge review: on macOS every CLI command piped through `| cat` or
    `| jq` emitted only the first 512 bytes of its JSON, because the CLI called
    `process.exit()` while asynchronous pipe writes were pending. Linux CI
    never shows it. The bug predates this branch. Fixed by setting
    `process.exitCode`; a test pipes `portfolio scan` through a shell and fails
    at exactly 512 bytes with the old code.

## Contributing Factors

- The fixture was designed from the spec, so it encoded the same assumptions as
  the code. No fixture used a relative submodule URL or a generated release
  workflow.
- CI workflow files mix runnable commands with orchestration. Treating every
  `run:` line as a command assumed workflows are written for humans.
- Text-based edits gave no signal when they matched nothing.

## What Reduced Impact

- Line hashes and evidence links made wrong citations visible on review.
- Read-only member repositories meant the real run could be repeated freely.
  A digest check confirmed no member repository changed.
- Deterministic output made before and after runs directly comparable.

## Corrective Actions

| Action                                                           | Owner | Status | Evidence                                                                               |
| ---------------------------------------------------------------- | ----- | ------ | -------------------------------------------------------------------------------------- |
| Keep scan writes and deletes inside the real output folder       | TBD   | done   | [portfolio-docs.test.js](../../portfolio-docs.test.js)                                 |
| Run test git without inherited GIT\_\* hook variables            | TBD   | done   | [portfolio-git.test.js](../../portfolio-git.test.js)                                   |
| Reject prototype keys and strip credentials from specs           | TBD   | done   | [portfolio-manifests.test.js](../../portfolio-manifests.test.js)                       |
| Resolve Go modules by longest path; report shared remotes        | TBD   | done   | [portfolio-edges.test.js](../../portfolio-edges.test.js)                               |
| Fail verify on edited manifests; skip unverifiable evidence      | TBD   | done   | [portfolio-docs.test.js](../../portfolio-docs.test.js)                                 |
| Encode link paths; embed SVGs only after a successful render     | TBD   | done   | [portfolio-docs.test.js](../../portfolio-docs.test.js)                                 |
| Resolve relative submodule URLs                                  | TBD   | done   | [portfolio-edges.test.js](../../portfolio-edges.test.js)                               |
| Filter release workflows, expressions, fragments, and installers | TBD   | done   | [portfolio-commands.test.js](../../portfolio-commands.test.js)                         |
| Cite description lines for purpose claims                        | TBD   | done   | [portfolio-model.test.js](../../portfolio-model.test.js)                               |
| Scope git metadata for nested folders                            | TBD   | done   | [portfolio-git.test.js](../../portfolio-git.test.js)                                   |
| Compact repository, dependency, and onboarding pages             | TBD   | done   | [portfolio-docs.test.js](../../portfolio-docs.test.js)                                 |
| Fix single-repository `scan` for Cargo workspaces and READMEs    | TBD   | open   | [research baseline](../research/01a103e77ce2751b-multi-repo-documentation-research.md) |

## Prevention Guidance

- Run every new extractor on real repositories before calling it done, and add
  each real failure to the fixture so the suite remembers it.
- When a test asserts a line number, make the expected line the one a reader
  would want to see, not the one the code happens to return.
- Prefer exact edit tools over scripted replacements, or assert that each
  replacement matched.
- Treat CI files as orchestration. Only extract lines a developer could run
  locally.
- Never let tests spawn git with the inherited environment. Git hooks export
  `GIT_DIR` and `GIT_INDEX_FILE`, and any test run from a hook inherits them.
- Check containment on real paths before creating anything, and never follow a
  symlink when writing or deleting generated output.
- Treat every URL-like string from a manifest as possibly secret.
- Run tests from a fresh temporary folder, never from fixed folders inside the
  repository, so parallel runs cannot share state.

## Follow-Up Validation

Re-run `xfeat portfolio scan` and `xfeat portfolio ci` on the same 74
repositories after any extractor change. The run after these fixes found the
`legi-france` to `legi-py` submodule edge, 0 noise lines among 168 CI commands,
0 broken links, and 0 verify findings.
