---
date: 2026-10-04
---

# Documentation Index

## Specs

| Document                                                                                               | Description                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Professional Documentation Workflow](./specs/0019ed76fba2f4da-professional-documentation-workflow.md) | Defines init, scan, audit, verify, and CI behavior for source-grounded docs, including polyglot manifests, public API rules per language, and which files `scan` may overwrite.               |
| [PlantUML Diagram Generation Quality](./specs/019f5e2f0f01a6b1-plantuml-diagram-generation-quality.md) | Rendering, layout, theme, and verification requirements for generated PlantUML SVG diagrams.                                                                                                  |
| [Portfolio Documentation](./specs/01a103e77d0e706f-portfolio-documentation.md)                         | Defines `xfeat portfolio` selection, generated pages, evidence hashes, cross-repo edges, and verify behavior.                                                                                 |
| [Portfolio Learning Path and Checks](./specs/01a10804fd3272c3-portfolio-learning-path-and-checks.md)   | Defines `learn.md`, `checks.json`, the `questions` and `grade` commands, and STE-lite writing rules; open it before changing checks or grading.                                               |
| [Rename xfeat to Graven](./specs/01a108ce87cf7694-graven-rename.md)                                    | Proposed rename to Graven: gates that must pass first, every user-facing name and its replacement, one-major-version compatibility, and the uncarved label; open it before renaming anything. |

## Research

| Document                                                                                                      | Description                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Multi-Repository Documentation Research](./research/01a103e77ce2751b-multi-repo-documentation-research.md)   | Sourced successes and failures of AI doc generators, developer portals, and doc frameworks; open it before changing portfolio output.                                          |
| [Explorable Docs and Curriculum Research](./research/01a10804fd3079f7-explorable-docs-curriculum-research.md) | Sourced evidence on ASD-STE100, code maps, and docs as a curriculum for people and agents; open it before adding maps, paths, or checks.                                       |
| [Product Name Research](./research/01a108ce87a97a40-product-name-research.md)                                 | Requirements, every candidate name with its verdict, why Stela was withdrawn, why Graven was chosen, and what is still unchecked; open it before changing the name or tagline. |

## Brand

| Document                                                             | Description                                                                                                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Graven Brand Guide](./brand/01a108ce87f47480-graven-brand-guide.md) | Name, story, positioning, messaging, vocabulary, voice, logo rules and files, colors, and type for Graven; open it before writing user-facing copy or using the logo. |

## Stories

| Document                                                                                                                           | Type    | Description                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Professional Documentation Workflow Success](./stories/0019ed76fce32b4e-professional-documentation-workflow-success.md)           | Success | Captures the source-grounded docs workflow delivery pattern.                                                                                                                                                      |
| [Professional PlantUML Diagram Generation Success](./stories/019f5e2f0f02b7c2-professional-plantuml-diagram-generation-success.md) | Success | Captures the verified shared-theme SVG generation pattern.                                                                                                                                                        |
| [PlantUML Diagram Generation Failure](./stories/019f5e2f0f03c8d3-plantuml-diagram-generation-failure.md)                           | Failure | Captures failed theme/layout experiments and corrective checks.                                                                                                                                                   |
| [Portfolio Documentation Success](./stories/01a103e77d3b7396-portfolio-documentation-success.md)                                   | Success | Records the evidence-first multi-repository pattern and its real-repository results; read before extending `xfeat portfolio`.                                                                                     |
| [Portfolio Documentation Failures](./stories/01a103e77d697ab1-portfolio-documentation-failures.md)                                 | Failure | Lists nine defects found by tests and a 74-repository dogfood run, with fixes and prevention rules.                                                                                                               |
| [Polyglot Scan Fix Success](./stories/01a10474c31b729b-polyglot-scan-fix-success.md)                                               | Success | Records the `xfeat scan` fix for Cargo, Python, and Go repositories, real-run evidence, seven delivery defects, and an independent review's findings with prevention rules; read before changing scan extraction. |
| [Portfolio Learning Path Success](./stories/01a10804fd337dd6-portfolio-learning-path-success.md)                                   | Success | Records why checks were built before maps, dogfood results on 75, 42, and 30 repositories, a paired agent evaluation, and the limits of lookup-style checks.                                                      |
| [Portfolio Learning Path Failures](./stories/01a10804fd347d07-portfolio-learning-path-failures.md)                                 | Failure | Lists defects found by fixture review, dogfood, a paired agent evaluation, and an independent pre-merge review, including incomplete answers and a biased grader, with prevention rules.                          |
| [Product Naming Failures](./stories/01a108ce88177c0e-product-naming-failures.md)                                                   | Failure | Records how a full identity was built for a conflicting name (Stela) and two logos failed, with prevention rules for naming and logo work.                                                                        |
