---
date: 2026-10-04
type: research
status: validated
related_specs:
  - ../specs/01a103e77d0e706f-portfolio-documentation.md
---

# Multi-Repository Documentation: Successes and Failures

This document records the research behind `xfeat portfolio`, the command that
documents a selection of repositories as one system. Read it before changing
what the portfolio generates, how it labels evidence, or which outputs it
refuses to produce.

## Method

- Three parallel research passes covered AI codebase documentation generators,
  multi-repository developer portals, and documentation structure frameworks.
- Decisive claims were re-checked against primary sources before they shaped a
  design decision. Those claims are marked **verified** below. Everything else is
  **reported**: the source says it, but the claim was not independently checked.
- Vendor sources (Port, Cortex, OpsLevel, Roadie, Swimm, Mintlify, Vercel,
  Spotify-as-seller) are treated as marketing unless an independent source agrees.
- A baseline run of the existing single-repository `xfeat scan` on a real Rust
  workspace (a scratch clone, not the original) captured local failure evidence.

## Failure Patterns

| Pattern                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                             | Status   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| AI wikis state invented facts with confidence            | Code Wiki answered that PostgreSQL has no cache support, while Microsoft's own documentation says it can back a distributed cache. It also did not flag that `vuejs/vue` reached end of life. [The Register](https://www.theregister.com/2025/11/17/google_previews_code_wiki/)                                                                                                      | verified |
| AI wikis rank by file size, not architecture             | Commenters on DeepWiki reported a wrong build system for LibreOffice and missing core LLVM subsystems. [HN](https://news.ycombinator.com/item?id=45002092)                                                                                                                                                                                                                           | reported |
| Generated repository overviews do not help coding agents | Context files did not generally improve agent task success and raised cost by more than 20%. Repository overviews were "not helpful". [Gloaguen et al., arXiv 2602.11988](https://arxiv.org/abs/2602.11988)                                                                                                                                                                          | verified |
| Documentation rots silently                              | Most of 3,000+ GitHub projects had at least one outdated code reference at some point in their history. [Tan et al., arXiv 2212.01479](https://arxiv.org/abs/2212.01479)                                                                                                                                                                                                             | verified |
| Static inference of cross-service edges is imperfect     | The best of nine static architecture-recovery tools reached F1 0.86; combining four tools reached 0.91. [arXiv 2412.08352](https://arxiv.org/abs/2412.08352)                                                                                                                                                                                                                         | verified |
| Name-only dependency matching is unsafe                  | Dependency confusion hijacked builds by publishing public packages under internal names. [Birsan](https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610)                                                                                                                                                                                                                 | reported |
| Hand-maintained catalogs drift and portals stall         | Backstage adopters reportedly stall near 10% adoption. The figure is an anecdote from a sponsored interview, not a measurement. [The New Stack](https://thenewstack.io/how-spotify-achieved-a-voluntary-99-internal-platform-adoption-rate/)                                                                                                                                         | reported |
| Empty Diátaxis scaffolds hurt                            | The author of Diátaxis advises against creating empty tutorial, how-to, reference, and explanation sections. [diataxis.fr](https://diataxis.fr/how-to-use-diataxis/)                                                                                                                                                                                                                 | reported |
| Cross-repo links against moving branches break builds    | Apache Camel Quarkus link checks against upstream `main` blocked every PR until versions were pinned. [camel-quarkus#2109](https://github.com/apache/camel-quarkus/issues/2109)                                                                                                                                                                                                      | reported |
| Citations raise trust even when they are wrong           | Random citations still increased user trust. [arXiv 2501.01303](https://arxiv.org/abs/2501.01303)                                                                                                                                                                                                                                                                                    | reported |
| Baseline `xfeat scan` misreads a polyglot Rust workspace | Running on a 24-file Rust workspace produced "No package metadata detected" (Cargo ignored), one `crates` component instead of one per crate, 0 public APIs (only JS `export` counts), and a README summary cut mid-sentence because wrapped lines were not joined. `scan` also writes into the target repository unconditionally, so it would overwrite hand-written `docs/` pages. | verified |

The baseline `xfeat scan` row is fixed: `scan` now reads every supported
manifest, splits workspaces into member components, detects public APIs per
language, joins wrapped README lines, and skips files it did not generate. See
the [polyglot scan fix story](../stories/01a10474c31b729b-polyglot-scan-fix-success.md).

## Success Patterns

| Pattern                                                  | Evidence                                                                                                                                                                                                                         | Status   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Check that every referenced entity exists                | DocAgent measured truthfulness as the share of referenced code entities that exist: 95.7% for its pipeline against 61% for a chat baseline. [arXiv 2504.08725](https://arxiv.org/abs/2504.08725)                                 | reported |
| Code-coupled docs fail CI when they drift                | Swimm tracks referenced snippets and paths and fails a check when they change. [Swimm docs](https://docs.swimm.io/features/keep-docs-updated-with-auto-sync/)                                                                    | reported |
| Explicit, pinned playbooks make aggregation reproducible | Antora playbooks list every source and ref. Couchbase builds from 63 sources and also emits `llms.txt`. [couchbase/docs-site](https://github.com/couchbase/docs-site)                                                            | reported |
| Ownership first, from enforced sources                   | Spotify's catalog started with components and teams. Shopify's ServicesDB checks ownership per service. [Shopify Engineering](https://shopify.engineering/e-commerce-at-scale-inside-shopifys-tech-stack)                        | reported |
| Central navigation, content stays in each repository     | GitLab builds one site from 6+ repositories with one owned navigation file and automatic missing-page reports. [GitLab docs](https://docs.gitlab.com/development/documentation/site_architecture/global_nav/)                    | reported |
| Landing pages route, they do not explain                 | Google's guidance calls landing pages "traffic cops". [Software Engineering at Google, ch. 10](https://abseil.io/resources/swe-book/html/ch10.html)                                                                              | reported |
| Small C4 levels are enough                               | C4 recommends context and container diagrams for most teams and a system landscape for multiple systems; it advises against code-level diagrams in long-lived docs. [c4model.com](https://c4model.com/diagrams/system-landscape) | reported |
| Short pages get read                                     | Users read about 20% of the words on an average page. [NN/g](https://www.nngroup.com/articles/how-little-do-users-read/)                                                                                                         | reported |
| Newcomers want to run the system first                   | Newcomers value early experimentation over complete documentation. [Dagenais et al., ICSE 2010](https://www.cs.mcgill.ca/~martin/papers/icse2010.pdf)                                                                            | reported |

## Decisions For `xfeat portfolio`

1. **Evidence or omit.** Every generated statement cites `repo@sha:path:line`
   and stores a hash of the cited line. Statements without evidence are not
   generated. `verify` re-reads every cited line and fails when the content
   changed or the file disappeared, and reports moved lines separately.
2. **Deterministic graph, typed confidence.** Cross-repository edges come only
   from declarations: path dependencies, git dependencies, Go module paths, git
   submodules, GitHub Actions `uses:`, and Terraform `source`. Package name matches are
   kept but labeled `name-match` because the registry source is not verified.
   Names provided by more than one selected repository are listed as ambiguous
   instead of guessed.
3. **Read-only member repositories.** The portfolio writes only to its own output
   folder. Generated output is a build artifact, never committed into members.
4. **Pin by SHA, not by time.** Every repository records its HEAD SHA, branch,
   and dirty state. Pages show "verified against" SHAs instead of "last
   updated". Dormancy is measured relative to the newest commit in the
   selection, so output stays deterministic for unchanged repositories.
5. **System model, not quadrants.** Pages follow landscape, repository, and
   integration levels. Each page declares its `type` in frontmatter.
6. **Gaps instead of stubs.** Missing owners, missing READMEs, missing declared
   test commands, missing CI, and unresolved edges go to one gaps page with
   coverage percentages. Empty sections are never rendered.
7. **Declared commands only.** Commands come from CI `run:` steps, package
   scripts, Makefile targets, and justfile recipes, labeled by source. xfeat
   does not invent ecosystem-default commands and labels every command as not
   executed by xfeat.
8. **Prefer existing metadata.** README, CODEOWNERS, Backstage
   `catalog-info.yaml`, package manifests, and the portfolio manifest are read as
   declared sources. xfeat links to existing docs and ADRs instead of
   paraphrasing them.
9. **Size budgets.** Landing page and repository pages stay compact and
   table-first. Complete inventories live in `portfolio.json` and reference
   tables, not in narrative pages.
10. **Agent output is an index, not prose.** `llms.txt` is a link index under
    8 KB. xfeat does not generate `AGENTS.md` or overview prose for agents.
11. **Private by default.** The aggregated graph exposes internal package names
    and hosts. Output is local files and git remote credentials are stripped.

## Challenges To The Original Request

- **"Well-structured" does not mean "more pages".** The evidence favors fewer,
  routed pages with complete machine-readable inventories behind them.
  Per-repository Diátaxis sets multiplied across many repositories would repeat
  the docs-graveyard failure.
- **No LLM narrative in this iteration.** Every failure documented above for AI
  wikis is a confident narrative error. A future LLM layer may only narrate the
  deterministic graph, must cite the same evidence, and must stay advisory in
  CI.
- **Edge recall is bounded.** Runtime calls through HTTP URLs, queues, or service
  registries are not detected. The landscape is a declared-dependency map, and
  the docs say so instead of implying completeness.

## Open Questions

- Should a Backstage `catalog-info.yaml` adapter be generated from the same
  model? It is deferred until the core output has been used on real portfolios.
- Should tier-2 heuristics (hostnames in compose or env files) be offered behind
  an explicit flag? They are deferred because their precision is unmeasured
  here.
- Task-based usefulness evaluation (an agent locating a feature using only the
  generated docs) is the right quality metric and is not yet automated.
