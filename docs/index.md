---
date: 2026-10-04
---

# Documentation Index

## Specs

| Document                                                                                               | Description                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Professional Documentation Workflow](./specs/0019ed76fba2f4da-professional-documentation-workflow.md) | Defines init, scan, audit, verify, and CI behavior for source-grounded docs, including polyglot manifests, public API rules per language, and which files `scan` may overwrite. |
| [PlantUML Diagram Generation Quality](./specs/019f5e2f0f01a6b1-plantuml-diagram-generation-quality.md) | Rendering, layout, theme, and verification requirements for generated PlantUML SVG diagrams.                                                                                    |
| [Portfolio Documentation](./specs/01a103e77d0e706f-portfolio-documentation.md)                         | Defines `xfeat portfolio` selection, generated pages, evidence hashes, cross-repo edges, and verify behavior.                                                                   |

## Research

| Document                                                                                                    | Description                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [Multi-Repository Documentation Research](./research/01a103e77ce2751b-multi-repo-documentation-research.md) | Sourced successes and failures of AI doc generators, developer portals, and doc frameworks; open it before changing portfolio output. |

## Stories

| Document                                                                                                                           | Type    | Description                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Professional Documentation Workflow Success](./stories/0019ed76fce32b4e-professional-documentation-workflow-success.md)           | Success | Captures the source-grounded docs workflow delivery pattern.                                                                                                                  |
| [Professional PlantUML Diagram Generation Success](./stories/019f5e2f0f02b7c2-professional-plantuml-diagram-generation-success.md) | Success | Captures the verified shared-theme SVG generation pattern.                                                                                                                    |
| [PlantUML Diagram Generation Failure](./stories/019f5e2f0f03c8d3-plantuml-diagram-generation-failure.md)                           | Failure | Captures failed theme/layout experiments and corrective checks.                                                                                                               |
| [Portfolio Documentation Success](./stories/01a103e77d3b7396-portfolio-documentation-success.md)                                   | Success | Records the evidence-first multi-repository pattern and its real-repository results; read before extending `xfeat portfolio`.                                                 |
| [Portfolio Documentation Failures](./stories/01a103e77d697ab1-portfolio-documentation-failures.md)                                 | Failure | Lists nine defects found by tests and a 74-repository dogfood run, with fixes and prevention rules.                                                                           |
| [Polyglot Scan Fix Success](./stories/01a10474c31b729b-polyglot-scan-fix-success.md)                                               | Success | Records the `xfeat scan` fix for Cargo, Python, and Go repositories, real-run evidence, and six delivery defects with prevention rules; read before changing scan extraction. |
