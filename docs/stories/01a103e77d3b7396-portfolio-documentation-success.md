---
date: 2026-10-04
type: success
status: validated
related_specs:
  - ../specs/01a103e77d0e706f-portfolio-documentation.md
evidence_links:
  - ../research/01a103e77ce2751b-multi-repo-documentation-research.md
  - ../../portfolio-docs.test.js
  - ../../lib/portfolio-docs.js
---

# Portfolio Documentation Success

## Context

Teams need one entry point for a set of repositories: what each one is for, who
owns it, how to run it, and what depends on what. AI wikis answer these
questions with confident prose that is often wrong, and developer portals stall
when their metadata is maintained by hand.

## Bet

A deterministic build that only states what a file declares, cites the exact
line, and reports what it could not find will be more useful than a longer
narrative. Gaps are part of the output, not a failure of it.

## What Worked

- **Evidence with line hashes.** Every claim stores the hash of the line it
  cites. `verify` separates moved lines (warning) from changed lines (failure),
  so reformatting does not break CI but real drift does.
- **Declared edges with typed confidence.** Path, git, Go module, submodule,
  GitHub Actions, and Terraform references are `declared`. Package-name matches
  are labeled `name-match`, and names provided by several repositories are
  reported as ambiguous instead of guessed.
- **Read-only members and a separate output folder.** The scan refuses an
  output folder inside a selected repository and never writes to members.
- **Deterministic output.** No timestamps, stable sorting, and SHA pinning mean
  a rescan of unchanged repositories is byte-identical, so a docs diff shows
  only real changes.
- **Gaps with coverage.** On real repositories the gaps page is the most
  informative page: it shows which declarations are missing across the set.

## Evidence

- 87 Jest tests pass, including an end-to-end fixture with npm, pnpm, Go,
  Python, protobuf, Backstage `catalog-info.yaml`, CODEOWNERS, GitHub Actions,
  a deprecated repository, a dormant repository, and a dirty working tree.
- Real run on 74 local repositories: 9.96 seconds, about 270 MB peak memory,
  85 generated files, 1,326 claims, and 0 verify findings or broken links in
  `xfeat portfolio ci`.
- A rescan with no repository changes produced an empty `diff -r`.
- Member repositories were unchanged after scanning, checked by git status and,
  in tests, by a content digest of every file.
- Coverage on the real set: owners declared for 1 of 74, purpose found for 58,
  declared test command for 36, CI for 24, license for 17. These numbers come
  from declarations, not inference, and they are actionable.

## Reusable Pattern

For documentation that spans systems, build the model deterministically from
declarations, attach line-hash evidence to every statement, label confidence
explicitly, and publish what is missing next to what is known. Add narrative
only on top of that model, and only with the same evidence.

## Limits

- Runtime calls through HTTP, queues, or service registries are not detected,
  so a portfolio of independent-looking repositories may still be coupled at
  runtime.
- Name-match edges cannot tell an internal package from a public one with the
  same name.
- Commands are copied, not executed. A declared command can still be broken.
- The real run used one person's repositories, which are mostly independent.
  Edge detection still needs a run on a tightly coupled organization.

## Follow-Up Check

Re-run the real-repository scan after extractor changes and compare edges,
command counts, and coverage with the numbers above. A task-based check, where
an agent must find a feature using only the generated pages, is the next
quality measure to automate.
