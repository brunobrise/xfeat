---
date: 2026-10-04
type: research
status: validated
related_specs:
  - ../specs/01a10804fd3272c3-portfolio-learning-path-and-checks.md
  - ../specs/01a103e77d0e706f-portfolio-documentation.md
---

# Explorable, Mappable, Curriculum Docs: Successes and Failures

This document records the research behind making xfeat output explorable,
mappable, and usable as a curriculum for people and coding agents. It also
answers whether generated prose should follow ASD-STE100 Simplified Technical
English. Read it before adding a map view, a learning path, generated
questions, an agent query surface, or a writing-style rule.

## Method

- Three parallel research passes covered controlled languages (ASD-STE100 and
  alternatives), explorable code and architecture maps, and documentation as a
  curriculum for people and agents.
- **verified** means the primary source was fetched and the claim confirmed.
  **reported** means a secondary source, an abstract, or a page that blocked
  access. Vendor numbers are marketing even when the page was fetched.
- The question was framed against the target interface in the request: a
  zoomable block map with eight relation types, a side panel of short
  sentences, and status badges.

## Controlled Language (ASD-STE100)

| Finding                                                                                                                                                                                                                                                                                                              | Status   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Issue 9 (2025-01-15) keeps 20-word procedural and 25-word descriptive sentence limits, one instruction per sentence, active voice, and noun clusters of three words or fewer. [ASD news](https://www.asd-europe.org/news-media/news-events/news/simplified-technical-english-asd-ste100-issue-9/)                    | verified |
| Core software verbs are not approved words: run (OPERATE), call (TELL), return (GO), fail, require, create, execute. Every other term needs manual classification as a technical noun or verb. Issue 9 PDF.                                                                                                          | verified |
| The copyright page forbids reproduction "in whole or in part" without written authority from ASD, and the name is an EU registered trademark. Free access does not mean free to embed. [FAQ](https://www.asd-europe.org/standards-specifications/simplified-technical-english/faq-simplified-technical-english-ste/) | verified |
| Boeing and University of Washington: comprehension improved only for the complex procedure, not the simple one, with no time difference. Non-native readers benefited most. [Holmback et al. 1996](https://mt-archive.net/90/CLAW-1996-Holmback.pdf)                                                                 | verified |
| A hybrid of simplified and normal English increased maintenance task errors. [Chervak & Drury 2002](https://researchconnect.buffalo.edu/en/publications/effects-of-job-instruction-on-maintenance-task-performance/)                                                                                                 | reported |
| Software companies wrote looser in-house rules instead of adopting AECMA SE: Sun (25-word cap), Avaya (open 250-term list), Ericsson (new words allowed with a definition). [Kuhn 2014](https://arxiv.org/pdf/1507.01701)                                                                                            | verified |
| Neural machine translation reversed the "avoid passives" rule: it lowered quality. [Marzouk 2021](https://openscience.ub.uni-mainz.de/server/api/core/bitstreams/26bfc90c-dfcc-4368-8c15-a343585a6c07/content)                                                                                                       | verified |
| An LLM prompted with full ASD-STE100 lost 22 of 47 code facts. A loose "simple technical English" prompt lost 4 of 47 and still halved sentence length. Four samples, self-scored. [Ghinda](https://allaboutcoding.ghinda.com/explain-to-me-in-simple-technical-english/)                                            | verified |
| Simplification inserts and omits facts, and common metrics miss it. [Devaraj 2022](https://arxiv.org/abs/2204.07562)                                                                                                                                                                                                 | reported |

**Decision:** do not adopt ASD-STE100 and do not claim STE compliance. Use an
STE-lite profile for generated prose: sentences of 25 words or fewer, one fact
per sentence, active voice by default, identifiers verbatim in backticks, and
one term per concept. Generated sentences come from templates, so the rule is
enforced by tests on rendered pages, not by prompting. Any future LLM-written
or human-written text must pass the same lint and keep every cited fact.

## Explorable Maps

| Pattern                                                                                                                                                                                                                                                                                                                               | Status   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Visualization-first code tools failed as products. CodeSee closed in February 2024 because "sales growth was inconsistent"; Sourcetrail was archived at the end of 2021. [GitKraken](https://www.gitkraken.com/press/gitkraken-acquires-codesee-launches-devex-platform), [Sourcetrail](https://github.com/CoatiSoftware/Sourcetrail) | verified |
| Visual Studio removed its UML designers because telemetry showed very few users. [Microsoft](https://devblogs.microsoft.com/devops/uml-designers-have-been-removed-layer-designer-now-supports-live-architectural-analysis/)                                                                                                          | verified |
| Teams use the top C4 levels: context 81%, container 79%, component 41% (vendor survey, n=75). [IcePanel](https://icepanel.io/blog/state-of-software-architecture-survey-2025)                                                                                                                                                         | verified |
| Structurizr rolls child relationships up to parents by default, so outer levels stay readable. [Structurizr](https://docs.structurizr.com/dsl/implied-relationships)                                                                                                                                                                  | verified |
| Backstage uses seven relation pairs. ArchiMate's eleven or more relation types are its most misused part. [Backstage](https://backstage.io/docs/features/software-catalog/well-known-relations/), [Sparx](https://sparxservices.com/insights/insight-61-archimate-relationships/)                                                     | verified |
| Graph views work as a mode inside existing tools, not as a replacement. [Debugger Canvas](https://www.microsoft.com/en-us/research/publication/debugger-canvas-industrial-experience-with-the-code-bubbles-paradigm/)                                                                                                                 | verified |
| Shortest-path tasks get hard above about 50 nodes in dense graphs. [Yoghourdjian 2020](https://arxiv.org/abs/2008.07944)                                                                                                                                                                                                              | verified |
| Developers ask reachability questions more than nine times a day, and 82% find them at least somewhat hard. [LaToza & Myers 2010](https://ecs.wgtn.ac.nz/foswiki/pub/Events/PLATEAU/2010Program/plateau10-latoza-slides.pdf)                                                                                                          | reported |
| 62% of 181 software visualization papers include no evaluation. [Merino 2018](https://scg.unibe.ch/research/softvis-eval)                                                                                                                                                                                                             | verified |

No controlled study found shows that a zoomable code map beats text for
comprehension.

## Curriculum For People

| Pattern                                                                                                                                                                                                                                                                                          | Status   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Khan Academy's explorable knowledge map left students "lost in space" and was replaced. [Kamens](https://bjk5.com/post/1664635835/constellation-knowledge)                                                                                                                                       | verified |
| Hyperlinked concept maps did no better than hyperlinked outlines (d=0.02, k=6). [Nesbit & Adesope 2006](https://www.sfu.ca/~jcnesbit/articles/NesbitAdesope2006.pdf)                                                                                                                             | verified |
| Duolingo replaced its skill tree with one path so learners cover material in the same order; free choice let many learners repeat easy lessons. No outcome numbers were published. [SEC filing](https://www.sec.gov/Archives/edgar/data/1562088/000156208822000058/duolingo_q1-2022xshareho.htm) | verified |
| Efficient newcomers got an overview first, then a small real task; one committed a fix on day one. [Dagenais et al. 2010](https://www.cs.mcgill.ca/~martin/papers/icse2010.pdf)                                                                                                                  | verified |
| Rust Book quizzes: 62,526 readers, 1.1 million answers. Targeted edits raised scores on targeted questions by 20%. Most readers stopped by chapter 4. [Crichton & Krishnamurthi 2024](https://arxiv.org/abs/2401.01257)                                                                          | verified |
| Practice testing (g about 0.5) and spacing rate as high utility; rereading and summarizing rate low. [Dunlosky](https://www.sciencedaily.com/releases/2013/01/130110111734.htm)                                                                                                                  | verified |
| Self-explanation prompts help (g=0.55). [Bisra 2018](https://www.gwern.net/doc/psychology/spaced-repetition/2018-bisra.pdf)                                                                                                                                                                      | verified |
| About half of 9,368 "good first issues" were not solved by newcomers. [Tan et al. 2020](https://2020.esec-fse.org/details/fse-2020-papers/172/A-First-Look-at-Good-First-Issues-on-GitHub)                                                                                                       | verified |
| Newcomer barriers are mostly social: 13 of 58 barriers, present in 75% of reviewed studies. [Steinmacher](https://www.ime.usp.br/~gerosa/papers/JCSCW_Steinmacher.pdf)                                                                                                                           | verified |
| DITA's rigid topic types and hand-kept relationship tables pushed writers away; DITA appears in 2.5% of writer job postings. [ditawriter](https://www.ditawriter.com/has-dita-plateaued/), [idratherbewriting](https://idratherbewriting.com/trends/trends-to-follow-or-forget-dita.html)        | verified |

## Curriculum For Agents

| Pattern                                                                                                                                                                                                                              | Status   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| LLM-generated context files changed task success by -0.5% to -2% and raised cost by 20% to 23%. Repository overviews did not shorten the path to relevant files. [Gloaguen et al.](https://arxiv.org/html/2602.11988)                | verified |
| Incorrect documentation hurts LLM code understanding much more than missing documentation. [Macke & Doyle](https://arxiv.org/abs/2404.03114)                                                                                         | verified |
| Curated, focused skills raised pass rate from 33.9% to 50.5%; self-generated skills and exhaustive docs lowered it. [SkillsBench](https://arxiv.org/abs/2602.12670)                                                                  | verified |
| Repository graphs add about 2 to 6 points on SWE-bench when anchored by lexical search. RepoGraph: 27.33% to 29.67% for Agentless. [RepoGraph](https://arxiv.org/html/2410.14684v2), [LocAgent](https://arxiv.org/html/2503.09089v1) | verified |
| A graph tool raised hidden-dependency tasks from 76.2% to 99.4% but was never called in 58% of trials. [CodeCompass](https://arxiv.org/html/2602.20048v1)                                                                            | verified |
| A bash-only agent scores above 74% on SWE-bench Verified. [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent)                                                                                                              | verified |
| No study found shows that pre-task quizzes improve agent task success. Generated questions do align well with learning objectives. [Doughty](https://arxiv.org/abs/2312.03173)                                                       | verified |

## Decisions

1. **Checks before maps.** The strongest evidence across all three passes
   supports retrieval practice for people and task-based evaluation for agents.
   xfeat generates checks: questions whose answers are computed from the
   portfolio model and cite the same claims that `verify` re-reads. A stale
   claim makes its check stale.
2. **One visible path, hidden graph.** A learning path is an ordered list of at
   most seven steps: orient, run, trace, and assess impact. Each step has one
   goal, links to read, declared commands, and at most three checks. Steps
   without evidence are not rendered.
3. **Checks double as an agent evaluation.** The same questions, without
   answers, can be given to an agent with and without the generated docs. A
   grader scores the answers deterministically. This is the task-based quality
   metric the
   [portfolio research](./01a103e77ce2751b-multi-repo-documentation-research.md)
   left open.
4. **Reachability is a first-class question.** "Which repositories can a change
   in X affect?" is answered with a cited path list, not a picture.
5. **Map later, as a navigation mode.** A map view is deferred. When built, it
   shows containment as nesting, at most about 20 nodes per view, parent edges
   rolled up with counts, neighbourhood edges only on selection, and nothing
   drawn without a citation.
6. **Small relation vocabulary.** Architecture edges stay at five types or
   fewer. Learning order uses separate `requires` relations and is never drawn
   on the architecture map.
7. **No agent overview prose.** xfeat still does not generate `AGENTS.md` or
   overview prose. Agents get the link index, the JSON model, the questions,
   and the grader.
8. **STE-lite, not STE.** See the controlled language section.

## Challenges To The Original Request

- **The map is the weakest part of the target interface.** The side panel holds
  the value. Its sentences must add purpose, invariants, and commands, not
  repeat the edge list beside them.
- **Eight relation types are too many.** Containment belongs in nesting.
  Duplicate edges to the same target belong in one edge with several pieces of
  evidence.
- **A uniform "ready" badge carries no information.** Show evidence state
  instead: verified against which SHA, and whether the claim is derived or
  declared.
- **"Curriculum for AI" does not mean persistent learning.** Agents do not keep
  knowledge between sessions. What transfers is a queryable model and a test
  of whether the docs help.

## Open Questions

- Does the generated path shorten time to a first merged change for a new
  engineer? This needs a human study.
- Do agents answer the checks better with the generated docs than with the raw
  repositories? A first run (one run per arm, 12 questions, one model) found
  equal accuracy and 47% fewer tool calls with the docs, which matches the
  efficiency-over-success pattern above. Single-hop lookups hit a ceiling;
  multi-hop questions and repeated runs are needed. See the
  [success story](../stories/01a10804fd337dd6-portfolio-learning-path-success.md).
- Should a project glossary order steps by term use? Deferred until the
  single-repository scan and the portfolio share one model.
- Should LLM-proposed claims (purpose, invariants) be allowed with a visible
  `proposed` label? Deferred; all output stays deterministic.
