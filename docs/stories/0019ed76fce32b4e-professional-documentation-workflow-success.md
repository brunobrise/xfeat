---
date: 2026-06-20
type: success
status: validated
related_spec: ../specs/0019ed76fba2f4da-professional-documentation-workflow.md
---

# Professional Documentation Workflow Success

## Context

`xfeat` needed to move from one-off architecture report generation toward a
workflow professional teams can run during onboarding and pull-request review.

## Bet

Source-grounded, deterministic documentation commands will create more trust
than a larger AI-only report because reviewers can inspect claims, rerun checks,
and see stale documentation failures in CI.

Semantic docs become useful only when the generated prose is organized around
engineering tasks: architecture explanation, component reference, onboarding,
and how-to guides. A symbol inventory alone is trustworthy but not sufficient.

## What Worked

- Keeping the new workflow deterministic avoids requiring credentials for audit
  and CI checks.
- Preserving the existing AI feature-map command avoids breaking current users.
- Writing `.xfeat/status.json` gives future agents and CI systems a stable
  machine-readable artifact.
- Treating stale code references and broken links as findings makes the first
  MVP useful without a hosted UI.
- Reading package metadata, source exports, local imports, scripts, tests, and
  source excerpts gives deterministic scan enough signal to explain purpose,
  runtime flow, public APIs, and common tasks.
- Keeping evidence links beside each generated claim preserves reviewer trust
  even when semantic wording is heuristic.
- Splitting readable narrative pages from complete reference appendices keeps
  onboarding usable while still preserving every generated claim, file, exported
  symbol, and import/dependency edge.

## Evidence

- Focused Jest coverage validates init, scan, audit, verify, and CI behavior.
- Focused Jest coverage validates semantic architecture, component, onboarding,
  and how-to docs generated from a package workspace fixture.
- Focused Jest coverage validates complete reference docs and prevents silent
  truncation of exported APIs, claims, import targets, and test evidence.
- Existing Jest tests continue to pass after the workflow is added.
- Lint, format, and build remain green before commit.

## Reusable Pattern

For professional documentation tooling, generate prose and verification metadata
together. A document without evidence is expensive to trust; evidence without a
human-readable document is hard to adopt.

Prefer deterministic semantic extraction before optional LLM synthesis. Package
metadata, public exports, import graphs, scripts, and tests cover many useful
documentation claims while remaining auditable in CI.

For larger repositories, write compact explanation pages plus exhaustive
reference appendices. Completeness belongs in appendices; orientation belongs in
overview, component, onboarding, and how-to pages.

## Limits

This MVP audits all Markdown when `--changed` is provided. Git-diff narrowing
can be added later while keeping the same command shape.

The semantic scan uses heuristics and will not infer product intent that is not
present in README files, package metadata, tests, scripts, imports, or source
symbols. Optional LLM review can be layered later, but should remain evidence
bound.
