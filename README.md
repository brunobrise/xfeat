# @brunobrise/xfeat

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-green.svg)](https://nodejs.org/)

**@brunobrise/xfeat** is a documentation CLI for codebase understanding. It can generate AI-assisted architecture and feature maps, and it now includes a deterministic professional documentation workflow for source-grounded docs, freshness audits, and CI verification.

## Key Features

- **AST-Powered Parsing:** Fast and accurate structural footprint generation (classes, functions, exports, imports) for modern ecosystem languages.
- **Agentic Source Code Reading:** Rather than guessing based off function identifiers, the AI utilizes a specialized `view_file` tool to selectively dive into the raw source code wherever AST context is insufficient.
- **Automated Mermaid Diagrams:** Visually maps out how files interact at macro and global architecture levels.
- **Structured Markdown Deliverables:** Produces a neat, hierarchical `FEATURES.md` report encompassing everything from the executive summary to granular file logic.
- **Smart Directory Traversal:** Adheres to your local `.gitignore` and optional custom `.xfeatignore` rules to avoid processing build artifacts and generic dependencies.
- **Source-Grounded Professional Docs:** Generates deterministic Diátaxis-style `docs/` pages with claim evidence, source files, symbols, package metadata, runtime flow, and line numbers.
- **Documentation Audit & CI Gate:** Detects stale code references, broken relative Markdown links, missing generated docs, and missing source evidence without requiring an LLM API key.
- **Multi-Repository Portfolio Docs:** Documents a selection of repositories as one system: owners, status, clone order, declared commands, cross-repository dependencies with typed confidence, and gaps, with every statement pinned to a source line and commit.

## How It Works

The engine executes in an expanding 4-stage pipeline:

0. **AI Pre-filtering (Stage 0):**
   - Interactively requests permission to AI-filter the target files.
   - Cleans the file list by intelligently removing trivial boilerplate, config files, and UI assets dynamically, saving time and tokens.

1. **Micro Analysis (File-Level):**
   - Identifies granular structural signatures across source files.
   - Leverages an LLM sub-agent loop to request file contents as needed.
   - Outputs 1-2 sentence overviews alongside high-level feature bullet points for each file.

2. **Macro Analysis (Component-Level):**
   - Groups files logically by their enclosing directory.
   - Synthesizes isolated file summaries into a curated **Component Summary**.
   - Generates localized [Mermaid.js](https://mermaid.js.org/) flow/architecture diagrams per directory.

3. **Global Analysis (System-Level):**
   - Ties localized component summaries together into a master architecture overview.
   - Documents the core pillars and overarching domain of the application.
   - Renders a highly-abstracted global Mermaid architecture diagram representing the entire system interaction.

## Installation

You can run `@brunobrise/xfeat` directly via `npx` without installing it globally:

```bash
npx @brunobrise/xfeat
```

## Configuration

Create a `.env` file at the root of the project to define your API authorization:

```env
# Required: Your Anthropic API Key
ANTHROPIC_API_KEY="sk-ant-..."

# Optional Environment Overrides
ANTHROPIC_AUTH_TOKEN=""
ANTHROPIC_BASE_URL=""
CLAUDE_CODE_SUBAGENT_MODEL="claude-sonnet-4-6"
```

## Usage

You can scan the immediate working directory, or pass a relative/absolute path to dynamically scan another repository on your machine.

### Scan Current Directory

```bash
npx @brunobrise/xfeat
```

### Scan Remote Directory Path

```bash
npx @brunobrise/xfeat /path/to/your/custom/project
```

## Professional Documentation Workflow

Use these commands when you need documentation that can run in onboarding, pull requests, and CI without interactive prompts.

### Initialize Documentation Policy

```bash
npx @brunobrise/xfeat init
```

This creates `.xfeat.yml`, `.xfeat/`, and the professional documentation folders if they do not already exist.

### Generate Source-Grounded Docs

```bash
npx @brunobrise/xfeat scan
```

The scan command reads package metadata, README content, source excerpts, public
symbols, local imports, scripts, and tests. It writes:

- `docs/architecture/overview.md`
- `docs/components/*.md`
- `docs/onboarding.md`
- `docs/how-to/*.md`
- `docs/reference/*.md`
- `docs/adr-index.md`
- `.xfeat/status.json`
- `xfeat-report.md`

The generated documentation follows Diátaxis roles:

- Architecture overview: explanation of system purpose, component map, runtime flow, and important public APIs.
- Component pages: reference docs for responsibilities, public APIs, important files, data flow, and source excerpts.
- Onboarding: a practical first reading path and first commands inferred from repository metadata.
- How-to guides: task guides inferred from package scripts and test files.
- Reference appendices: complete generated inventories for claims, files, exported symbols, and import/dependency edges.

Package metadata comes from `package.json`, `Cargo.toml`, `pyproject.toml`,
`requirements.txt`, `go.mod`, and `composer.json`, so polyglot repositories are
documented across ecosystems. Each workspace member (npm `workspaces`, Cargo
`workspace.members`) becomes its own component, and runtime dependencies between
packages appear as dependency flows. Public APIs follow each language's
visibility rules: JavaScript and TypeScript `export`, Rust `pub` items (not
`pub(crate)`), exported Go identifiers, and Python module-level names or
`__all__`. The README summary is the first prose paragraph, with wrapped lines
joined.

`scan` never overwrites a file it did not generate. Every generated page starts
with an `<!-- xfeat:generated ... -->` marker line. An existing file at a
generated path without that marker, a symbolic link, or a path that resolves
outside the repository is left untouched and listed under `skipped` in the JSON
output and in `xfeat-report.md`. Delete the marker line from a generated page to
keep manual edits; later scans then skip it. Pages written by earlier xfeat
versions, before the marker existed, are recognized by their opening lines and
updated. `scan` also prints one warning line on stderr when it skips files.

### Audit Documentation Freshness

```bash
npx @brunobrise/xfeat audit --changed
```

The audit command reports stale backticked code references and broken relative Markdown links. The `--changed` flag is accepted for CI compatibility; the current MVP audits all Markdown files.

### Verify Generated Evidence

```bash
npx @brunobrise/xfeat verify
```

The verify command checks that generated documents exist and that every claim in `.xfeat/status.json` points to a current source file.

### Run CI Gate

```bash
npx @brunobrise/xfeat ci --changed
```

The CI command runs audit and verify together, prints a JSON report, and exits nonzero when blocking findings exist.

## Portfolio Documentation

`xfeat portfolio` documents a selection of repositories as one system. It reads each repository without modifying it and writes a separate output folder. No API key is required. Design decisions and their evidence are recorded in [the research](docs/research/01a103e77ce2751b-multi-repo-documentation-research.md) and [the spec](docs/specs/01a103e77d0e706f-portfolio-documentation.md).

### Select Repositories

Create a reviewable selection from a parent folder of git repositories:

```bash
npx @brunobrise/xfeat portfolio init --from ~/code/acme --exclude "legacy-*"
```

This writes `xfeat.portfolio.json`, or the path given with `--manifest`, creating missing folders. Paths in the manifest, including `--out`, are stored relative to the manifest. The manifest can be edited to add owners, systems, lifecycle, and notes:

```json
{
  "name": "Billing Platform",
  "output": "xfeat-portfolio",
  "repos": [
    {
      "path": "../billing-api",
      "system": "billing",
      "owner": "@acme/payments"
    },
    { "path": "../billing-web" }
  ]
}
```

Repository paths can also be passed directly: `xfeat portfolio scan ../billing-api ../billing-web --out portfolio-docs`.

### Generate Portfolio Docs

```bash
npx @brunobrise/xfeat portfolio scan
npx @brunobrise/xfeat portfolio scan --render-diagrams
```

| Output                     | Content                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `index.md`                 | Repository table grouped by system: purpose, owner, status, languages, verified commit.      |
| `learn.md`                 | Ordered learning path: orient, run, trace, impact, change, with up to three checks per step. |
| `getting-started.md`       | Clone order with providers first, and declared commands per repository.                      |
| `landscape.md`             | Cross-repository dependencies and a PlantUML landscape diagram.                              |
| `repos/{slug}.md`          | One page per repository: ownership, modules, interfaces, commands, dependencies, gaps.       |
| `integrations/{a}--{b}.md` | One page per connected pair, with consumer and provider evidence.                            |
| `gaps.md`                  | Coverage of owners, purpose, test commands, CI, and licenses, plus ambiguous names.          |
| `dependencies.md`          | Shared external dependencies with version drift, and shared protobuf contracts.              |
| `packages.md`              | Which repository defines each package or module name.                                        |
| `decisions.md`             | Architecture decision records found across repositories.                                     |
| `llms.txt`                 | A link index for coding agents, under 8 KB.                                                  |
| `portfolio.json`           | The complete model, including every claim with its source line hash and repository SHAs.     |
| `checks.json`              | Questions with answers computed from declared facts, each citing the claims it relies on.    |

Evidence links point to commit permalinks on GitHub, GitLab, and Bitbucket when the repository is clean, and to local files otherwise. Re-running `scan` on unchanged repositories produces byte-identical output.

Cross-repository edges are detected only from declarations: path and git dependencies, Go module paths, git submodules, GitHub Actions `uses:`, and Terraform module sources. A dependency that only matches a package name provided by another selected repository is labeled `name-match`, because the registry it resolves from is not verified. Runtime calls through HTTP, queues, or service registries are not detected.

### Verify Portfolio Freshness

```bash
npx @brunobrise/xfeat portfolio verify
npx @brunobrise/xfeat portfolio ci
```

`verify` re-reads every cited line. It fails when a cited line changed, a cited file or repository disappeared, a generated page is missing, or `xfeat.portfolio.json` was edited after the scan, and it warns when a cited line only moved. Findings for a changed or missing line list the checks in `checks.json` that rely on it. Because a newly added dependency changes no cited line, `verify` also rebuilds the model read-only and recomputes the checks: a changed or removed answer fails as `stale-check`, while new checks and a new focus repository are warnings. This makes `verify` about as costly as `scan`; on 75 repositories it took 15 seconds. `ci` adds a check of relative links inside the output. Both print JSON and exit nonzero on blocking findings. Options a command does not use are rejected rather than ignored.

### Learn and Evaluate

`learn.md` is an ordered path for engineers who are new to the selection. It picks a focus repository that is active, connected, and testable, then walks through up to five steps: orient, run, trace one dependency, assess impact, and make a change. Each step has one goal and at most three checks. Answers are hidden until opened and link to the cited source line.

The same checks measure whether the docs help a reader or a coding agent:

```bash
npx @brunobrise/xfeat portfolio questions > questions.json
npx @brunobrise/xfeat portfolio grade --answers answers.json --min-score 0.8
```

`questions` prints every check without its answer. `answers.json` maps check ids to a string or a list of strings. Questions whose format starts with "list of" take a list; every other question takes one value, and a list that hedges across several values is graded wrong. `grade` compares answers deterministically, ignoring case for repository names and owners and treating equivalent test invocations such as `npm test` and `npm run test` as equal, and prints a score with one result per check and a `byHops` breakdown. Each check records `hops`, the number of facts a reader must connect: single lookups have 1, joins such as "the tests of the repository that provides the program `x`" have 2, and dependency closures count their longest chain. Lookups are easy to answer by search, so multi-hop accuracy is the more telling number. With `--min-score`, it exits nonzero below the threshold. To compare runs, give an agent the questions once with only the repositories and once with the generated docs, then grade both answer files.

Checks use only declared, cited facts. Package-name matches and ambiguous names are excluded because their answers are not verified. The design rationale, including why generated text follows short-sentence rules instead of ASD-STE100, is recorded in [the research](docs/research/01a10804fd3079f7-explorable-docs-curriculum-research.md).

The output exposes internal package names, owners, and hosts. Treat it as internal documentation. Credentials in git remotes and dependency URLs are always removed.

The output folder must resolve outside every selected repository. `scan` never writes through symlinks, and on a rescan it removes only pages it generated earlier. Hand-written files in the output folder are kept.

## Development Tooling

For developers contributing to this tool, standard npm scripts are available:

- `npm run dev` — Hot-reloads the analysis script using Nodemon.
- `npm run lint` — Analyzes the source using ESLint against best practices.
- `npm run format` — Standardizes code styling uniformly with Prettier.

## Expected Output

The script concludes by generating a structured `FEATURES.md` record at your execution root. Inside, you can expect:

1. **Global Architecture Overview** _(Executive Summary, Application Pillars, Main System Diagram)_
2. **Component Breakdown** _(Directory-by-Directory Insights, Narrow Context Diagrams)_
3. **File-Level Details** _(Deeply granular feature lists)_

The professional workflow writes source-grounded docs under `docs/` and machine-readable verification metadata under `.xfeat/status.json`.

## Supported Languages

The foundational Tree-sitter AST parser natively understands:

- JavaScript (`.js`, `.jsx`)
- TypeScript (`.ts`, `.tsx`)
- Python (`.py`)
- Rust (`.rs`)
- Go (`.go`)
- Java (`.java`)
- PHP (`.php`)

## License

This tooling is open-sourced under the **MIT** License.

---

_Built organically with the [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) and [Tree-sitter](https://tree-sitter.github.io/tree-sitter/)._
