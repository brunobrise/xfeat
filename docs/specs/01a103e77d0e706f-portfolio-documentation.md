---
date: 2026-10-04
status: implemented
owner: TBD
related_research:
  - ../research/01a103e77ce2751b-multi-repo-documentation-research.md
---

# Portfolio Documentation

## Problem

Teams rarely own one repository. Onboarding, incident response, and planning
need answers that span repositories: what each one is for, who owns it, how to
run it, and which repositories depend on which. `xfeat scan` documents one
repository and writes into it. It cannot describe a system made of several
repositories, and its single-repository heuristics misread polyglot
repositories (see the baseline failure in the
[research](../research/01a103e77ce2751b-multi-repo-documentation-research.md)).

## Goal

Add `xfeat portfolio`, a deterministic documentation build for a reviewable
selection of repositories. It produces a small set of routed pages backed by a
complete machine-readable model, and a verifier that fails when cited evidence
changes.

## User Outcome

An engineer joining a multi-repository team opens one `index.md`, finds which
repositories exist, who owns them, which ones to clone first, how to run them,
and how they connect, with every statement linked to the exact source line it
came from. A CI job can re-run `xfeat portfolio verify` and fail when that
evidence drifts.

## Scope

- `xfeat portfolio init` writes a reviewable `xfeat.portfolio.json` from a
  parent folder of repositories.
- `xfeat portfolio scan` reads the selection and writes the output folder.
- `xfeat portfolio verify` checks the output against the current repositories.
- `xfeat portfolio ci` runs verify plus a relative-link audit of the output.
- Ecosystems: npm, Cargo, Python (`pyproject.toml`, `requirements.txt`), Go,
  and Composer manifests, plus CODEOWNERS, Backstage `catalog-info.yaml`, CI
  workflows, Makefiles, justfiles, compose files, and API contract files.

## Non-Goals

- No LLM calls and no API key requirement.
- No cloning, fetching, or checking out refs. xfeat documents working trees as
  they are and records their SHAs.
- No writes into member repositories.
- No detection of runtime calls through HTTP URLs, queues, or service
  registries. The landscape is a declared-dependency map.
- No Backstage, MkDocs, or Antora adapters in this iteration.
- No generated `AGENTS.md` or overview prose for coding agents.

## Workflow

### Diagram: Portfolio Pipeline

![Portfolio pipeline](./diagrams/01a103e77d0e706f/portfolio-pipeline.svg)

This diagram shows how a selection becomes pages and a verifiable model. Read it
when changing where a fact is collected or which stage owns a decision.

- Main entities: the selection is the only list of repositories xfeat may read.
  The fact collector reads each repository without writing to it. The edge
  resolver matches declarations across repositories. The renderer turns the
  model into pages and `portfolio.json`. `verify` compares `portfolio.json`
  against the repositories later.
- Flow: 1. Load the selection from a manifest, explicit paths, or `--from`. 2. Collect facts per repository. 3. Resolve cross-repository edges. 4. Render
  pages and the model. 5. Verify on demand.
- Failure and edge paths: missing paths stop the scan with an actionable error.
  Unparseable manifests are recorded as gaps and do not stop the scan.
- References: [selection](../../lib/portfolio-selection.js),
  [manifests](../../lib/portfolio-manifests.js),
  [git metadata](../../lib/portfolio-git.js),
  [signals](../../lib/portfolio-signals.js),
  [commands](../../lib/portfolio-commands.js),
  [evidence](../../lib/portfolio-evidence.js).

### Diagram: Generated Pages

![Generated pages](./diagrams/01a103e77d0e706f/portfolio-pages.svg)

This diagram shows how generated pages route readers. Read it when adding,
removing, or renaming a generated page.

- Main entities: `index.md` routes and holds the only repository table.
  Repository pages describe one repository. Integration pages describe one
  pair of repositories that declare an edge. `gaps.md` reports what is unknown.
  Reference pages hold complete tables.
- Flow: 1. Start at `index.md`. 2. Use `getting-started.md` to clone and run. 3. Open a repository page for detail. 4. Follow an integration page to see
  both sides of a dependency.
- Failure and edge paths: pages with no content are not generated. A portfolio
  with no edges has no integration pages, and `landscape.md` says so.

### Diagram: Verification

![Portfolio verification](./diagrams/01a103e77d0e706f/portfolio-verify.svg)

This diagram shows how `verify` decides whether output is stale. Read it when
changing finding types or exit codes.

- Flow: 1. Load `portfolio.json`. 2. For each repository, re-read every cited
  line and compare its hash. 3. Check generated pages exist. 4. Exit 0 only
  without blocking findings.
- Failure and edge paths: a cited line that moved is a warning, not a failure.
  A changed or missing line fails. A repository whose HEAD advanced without
  changing cited lines is informational.

## Selection Manifest

`xfeat.portfolio.json` is JSON so it needs no parser dependency. Paths resolve
relative to the manifest file.

```json
{
  "name": "Billing Platform",
  "description": "Services that invoice and collect payments.",
  "output": "xfeat-portfolio",
  "repos": [
    {
      "path": "../billing-api",
      "system": "billing",
      "owner": "@acme/payments",
      "lifecycle": "production",
      "notes": "Owns the invoice state machine."
    },
    { "path": "../billing-web", "name": "Billing Web" }
  ]
}
```

- `path` is required. `name`, `description`, `system`, `owner`, `lifecycle`,
  `notes`, and `tags` are optional and are labeled `manifest` when rendered.
- Duplicate paths are removed. Duplicate names get parent-folder slugs.
- A selected folder inside a larger git repository is supported. Its git data
  is scoped to the folder.

## CLI Behavior

- `xfeat portfolio init [--from <dir>] [--include <glob>] [--exclude <glob>]
[--manifest <file>]` writes the manifest and never overwrites one.
- `xfeat portfolio scan [paths...] [--manifest <file>] [--from <dir>]
[--include <glob>] [--exclude <glob>] [--out <dir>] [--render-diagrams]`.
  Without paths, `--from`, or `--manifest`, it uses `./xfeat.portfolio.json`.
- `xfeat portfolio verify [--out <dir>] [--manifest <file>]`.
- `xfeat portfolio ci [--out <dir>] [--manifest <file>]`.
- Every command prints one JSON object and exits nonzero on blocking findings.

## Output

| Path                       | Type        | Content                                                                                  |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `index.md`                 | landscape   | Repository table grouped by system: purpose, owner, status, languages, verified SHA.     |
| `getting-started.md`       | tutorial    | Clone order with providers before consumers, and declared commands per repository.       |
| `landscape.md`             | landscape   | Declared edge table and a PlantUML landscape diagram source.                             |
| `repos/{slug}.md`          | repository  | Purpose, ownership, status, modules, interfaces, commands, dependencies, docs, gaps.     |
| `integrations/{a}--{b}.md` | integration | Every edge between two repositories with consumer and provider evidence.                 |
| `dependencies.md`          | reference   | Internal edges and external dependencies shared by several repositories with versions.   |
| `packages.md`              | reference   | Every package or module name each repository provides, with ambiguous names flagged.     |
| `decisions.md`             | reference   | ADRs found across repositories, linked in place.                                         |
| `gaps.md`                  | gaps        | Coverage percentages, per-repository gaps, ambiguous and unresolved edges.               |
| `llms.txt`                 | agent index | Link index under 8 KB. No prose summaries.                                               |
| `portfolio.json`           | model       | Selection, repository facts, edges, claims with line hashes, SHAs, generated documents.  |
| `diagrams/landscape.puml`  | diagram     | PlantUML source. `--render-diagrams` also writes `landscape.svg` when `plantuml` exists. |

Every Markdown page starts with frontmatter declaring `type` and `generator`.
Output contains no timestamps, so re-running on unchanged repositories produces
byte-identical files.

## Evidence Model

- Every claim stores `{ repo, file, line, hash }`, where `hash` is the first 16
  hex characters of the SHA-256 of the trimmed cited line.
- Claims are labeled `source` (read directly from a file), `derived` (computed
  from several sources, such as dormancy), or `manifest` (declared in
  `xfeat.portfolio.json`).
- Evidence links use commit permalinks for GitHub, GitLab, and Bitbucket when the
  repository is clean and the file is tracked. Otherwise they use a relative
  path to the local file.
- Remote URLs are normalized to `https://host/path` and embedded credentials are
  always removed.

## Cross-Repository Edges

| Kind               | Detection                                                                                                     | Confidence   |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ------------ |
| `path-dependency`  | A manifest dependency path resolves inside another selected repository.                                       | `declared`   |
| `git-dependency`   | A dependency git URL matches another repository's remote.                                                     | `declared`   |
| `go-module`        | A `go.mod` requirement starts with another repository's module path.                                          | `declared`   |
| `git-submodule`    | A `.gitmodules` URL, resolved like git resolves relative URLs, matches another repository's remote or folder. | `declared`   |
| `github-action`    | A workflow `uses:` references another repository's remote.                                                    | `declared`   |
| `terraform-module` | A Terraform `source` references another repository's remote.                                                  | `declared`   |
| `package-name`     | A dependency name equals a package another repository provides, by ecosystem.                                 | `name-match` |

- Names are compared per ecosystem after normalization (PEP 503 for Python,
  `_` and `-` equivalence for Cargo, lowercase for npm and Composer, exact for
  Go).
- A dependency whose name is also provided by the consuming repository is
  internal and is not an edge.
- A name provided by several selected repositories is reported as ambiguous in
  `gaps.md` and is not drawn.

## Commands

- Sources: CI `run:` steps and GitLab `script:` entries, package scripts,
  Makefile targets, and justfile recipes. CI wins on duplicates because it is
  evidence the command runs.
- Workflows whose file name mentions release, publish, deploy, backup, pages,
  labeler, stale, pr-title, or dependabot are skipped for commands. They are
  still read for `uses:` references.
- CI lines with workflow expressions (`${{ }}`, `$GITHUB_*`), shell control
  fragments, file chores, and toolchain installers are dropped.
- Categories (setup, build, test, lint, run, other) are matched with flags
  removed, so `--output-format` does not read as a lint command.
- `getting-started.md` shows one command per essential category. Repository
  pages list every declared command.

## Status, Ownership, And Systems

- Owner precedence: portfolio manifest, then `catalog-info.yaml` `spec.owner`,
  then the last catch-all CODEOWNERS rule. No owner is a gap.
- Lifecycle precedence: portfolio manifest, then `catalog-info.yaml`
  `spec.lifecycle`, then `deprecated` when the README declares deprecation, then
  `dormant` when the last commit is more than 365 days older than the newest
  commit in the selection, then `active`. Folders without git are `unknown`.
- System precedence: portfolio manifest, then `catalog-info.yaml`
  `spec.system`, then `Ungrouped`.

## Gaps

Each repository can report: no README summary, no owner, no declared test
command, no CI workflow, no license, deprecated, dormant, uncommitted changes,
and manifest parse errors. `gaps.md` also lists ambiguous package names and the
percentage of repositories with an owner, a README summary, a declared test
command, CI, and a license.

## Limits

- Files larger than 1 MB are not read as evidence.
- At most 200 protobuf files per repository are read for package names.
- Lines are hashed after trimming whitespace, so indentation changes do not mark
  evidence stale.
- Links for repositories with uncommitted changes, no commits, or no supported
  remote point to local files and only work on the machine that ran the scan.
  `scan` reports them as a warning.

## Acceptance Criteria

- Focused tests cover the TOML reader, manifest readers, selection, git metadata,
  signals, commands, edges, rendering, verify, and the CLI.
- A multi-repository fixture with npm, Cargo, Python, and Go produces resolved
  edges, a name-match edge, an ambiguous name, an integration page, and gaps.
- Scanning never modifies member repositories.
- Scanning twice without repository changes produces byte-identical output.
- `verify` passes after scan, warns on moved lines, and fails on changed lines,
  deleted files, and deleted repositories.
- Remote credentials never appear in output.
- New non-Markdown files stay below 420 lines. Lint and the full test suite pass.
- A dogfood run on real local repositories is recorded as a success or failure
  story.

## Test Plan

- Unit tests per module with temporary folders and real `git` repositories.
- One end-to-end fixture scanned through `runPortfolioCommand` and through the
  CLI binary.
- Dogfood on a selection of local repositories covering Rust, TypeScript, and
  Python, with results recorded in `docs/stories`.
