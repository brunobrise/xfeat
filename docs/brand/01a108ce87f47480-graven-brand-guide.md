---
date: 2026-10-04
status: draft
related_specs:
  - ../specs/01a108ce87cf7694-graven-rename.md
related_docs:
  - ../research/01a108ce87a97a40-product-name-research.md
---

# Graven Brand Guide

The identity for Graven, the planned name for xfeat. Open this guide before
writing user-facing copy, CLI output, badges, or anything with the logo. The
name is not live until the [rename spec](../specs/01a108ce87cf7694-graven-rename.md)
gates pass.

## Name

- **Graven** means carved, from Old English _grafan_. Say it GRAY-vən.
- Write **Graven** in sentences, **GRAVEN** only in the wordmark, and
  `graven` for the CLI.
- Never: Gravin, GravenAI, Graven Docs, "graven image", "grave".

## Story

Around 1754 BC, Hammurabi of Babylon had his laws graven into a black stone
pillar and set it where anyone could read it. The law stopped being what
someone remembered. It became what the stone said. Code is the law of a
software system. Graven carves its documentation from that law, line by line.

Use the story once per surface: landing page, first minute of a pitch, talks.
Hammurabi is the myth behind the brand, never the brand. Sources are in the
[name research](../research/01a108ce87a97a40-product-name-research.md#origin-story-facts).

## Positioning

For platform and engineering leaders running many repositories, Graven is
evidence-grounded documentation: it writes docs from source and pins every
claim to a file, line, and commit. Unlike AI doc generators, it does not
paraphrase code. It cites it.

| Pillar | Promise                        | Proof in the product                                                                        |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------- |
| Carved | Every claim cites its source.  | Claims store file, line, symbol, and commit.                                                |
| Kept   | Drift fails the build.         | `verify` and `ci` re-read every cited line and exit nonzero on change.                      |
| Whole  | One system, many repositories. | `portfolio` maps owners, commands, and cross-repository dependencies with typed confidence. |

## Messaging

| Use             | Line                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary tagline | Documentation, carved from code.                                                                                                                             |
| Manifesto       | Your code is law. Graven writes it down.                                                                                                                     |
| Enterprise      | Architecture docs with an audit trail.                                                                                                                       |
| Developer       | Docs that fail CI when they lie.                                                                                                                             |
| One-liner       | Graven writes documentation from your source code and pins every claim to a file, line, and commit. When the code changes, CI fails until the docs catch up. |

## Vocabulary

Use these four words the same way in the CLI, docs, badge, and pitch. Do not
extend the metaphor: no gavels, no courtroom jokes.

| Word     | Meaning                                                                          |
| -------- | -------------------------------------------------------------------------------- |
| carved   | A claim backed by a file, line, and commit, verified at the current HEAD.        |
| exhibit  | The evidence behind a claim, for example `lib/portfolio-edges.js:88 @ fe2fe21`.  |
| drift    | A cited line changed or vanished. Blocking. A line that only moved is a warning. |
| uncarved | Text a language model wrote with no evidence attached. Always labeled.           |

## Voice

- Cite our own claims. A number in marketing links to the run that measured it.
- Name the file, not the feeling: "3 claims drifted. Update the docs or run
  `graven scan`.", never "Oops! Something went wrong."
- Lead with evidence. Models are a tool inside the product, never the headline.

## Logo

A stone with one chisel cut. The cut draws a G.

![Graven mark](./01a108ce87f47480/graven-mark-basalt.svg)

- **One color.** Basalt, chalk, lapis, or white. No second color, gradient,
  outline, bevel, or stone texture.
- **Geometry.** On a 64-unit grid: stone 40 × 52 units, arch radius 20, flat
  base. One cut, 7 units deep, enters from the right and turns down into the
  counter. Solid strokes are at least 8 units, openings at least 7, so the G
  holds at 16 px. The path is
  `M12 58V26a20 20 0 0 1 40 0v32zM22 28h30v7H32v8h10v7H22z` with
  `fill-rule="evenodd"` and `viewBox="12 6 40 52"`.
- **Clear space** is half the stone width on every side. **Minimum** 12 px tall.
- **Never** stretch it, recolor part of it, or add cuts or text to the stone.
- **Wordmark:** GRAVEN in Marcellus with +300 tracking (0.3em). Export it as outlines
  before using it outside the web.

| File                                                                | Use                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| [graven-mark-basalt.svg](./01a108ce87f47480/graven-mark-basalt.svg) | Mark on light backgrounds.                             |
| [graven-mark-chalk.svg](./01a108ce87f47480/graven-mark-chalk.svg)   | Mark on dark backgrounds.                              |
| [graven-mark-lapis.svg](./01a108ce87f47480/graven-mark-lapis.svg)   | Mark on white, as the single accent.                   |
| [graven-mark-white.svg](./01a108ce87f47480/graven-mark-white.svg)   | Mark on lapis or photos.                               |
| [graven-app-icon.svg](./01a108ce87f47480/graven-app-icon.svg)       | App and PWA icon, 512 px.                              |
| [graven-avatar.svg](./01a108ce87f47480/graven-avatar.svg)           | GitHub, npm, and Slack avatars; safe in a circle crop. |
| [graven-favicon.svg](./01a108ce87f47480/graven-favicon.svg)         | Favicon; switches to chalk in dark mode.               |
| [graven-banner.txt](./01a108ce87f47480/graven-banner.txt)           | Block-character banner for the CLI.                    |

## Color

| Name     | Light     | Dark             | Role                           |
| -------- | --------- | ---------------- | ------------------------------ |
| Basalt   | `#16181E` | `#0F1115` ground | Ink and slab.                  |
| Chalk    | `#ECEEF1` | `#E6E8EC` text   | Ground.                        |
| Lapis    | `#2E4BD1` | `#8DA0FF`        | Evidence, links, carved state. |
| Cinnabar | `#B83A26` | `#F07A63`        | Drift only.                    |
| Slate    | `#5C6371` | `#9AA1AE`        | Secondary text.                |

Proportion on any surface: basalt and chalk 90%, slate 6%, lapis 3%, cinnabar
1% and only when something drifted.

## Typography

| Role     | Face          | Use                          |
| -------- | ------------- | ---------------------------- |
| Display  | Marcellus     | Wordmark and headlines only. |
| Body     | IBM Plex Sans | All running text.            |
| Evidence | IBM Plex Mono | Paths, commits, CLI output.  |

All three are on Google Fonts under the SIL Open Font License.
