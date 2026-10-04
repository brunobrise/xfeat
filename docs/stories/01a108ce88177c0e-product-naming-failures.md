---
date: 2026-10-04
type: failure
status: validated
related_specs:
  - ../specs/01a108ce87cf7694-graven-rename.md
evidence_links:
  - ../research/01a108ce87a97a40-product-name-research.md
  - ../brand/01a108ce87f47480-graven-brand-guide.md
---

# Product Naming Failures

## Summary

Choosing a new name for xfeat took seven rounds. A complete identity (story,
positioning, vocabulary, logo, colors, rename map) was built for **Stela**
before a conflict check found STELA, an established test automation product in
the same market. The name moved to **Graven**. Two logos were also rejected
before the final mark. No code changed, so the cost was review time, not
users.

## Impact

- One full brand identity was rebuilt for a new name and a new letterform.
- The first logo worked only at large sizes and in two colors.

## What went wrong

1. **Conflict check came last.** Candidates were checked for npm names and
   `.com`, `.dev`, and `.sh` nameservers only. STELA lives at `stela.ai` and on
   G2, Capterra, and GetApp. A search of software review sites would have found
   it in one query, before any design work.
2. **Requirements arrived one at a time.** Catchy, then "code is law" and
   storytelling, then bold, then enterprise, then famous storytellers. Each
   round rejected the previous winner. Plumb, Lore, and Hammurabi each failed
   a requirement stated after they were proposed.
3. **The first logo was designed for a poster.** A tall 3:8 stone with thin
   carved lines and a two-color breakout line. Below 32 px the lines vanished,
   it could not print in one ink, and it did not fit square or round avatars.
4. **The second logo was tied to the name.** The S drawn by two cuts was good,
   but it had to be redrawn as a G when the name changed.

## What worked

- Withdrawing Stela before anything was registered, published, or pushed.
- Keeping the story, palette, type, and vocabulary independent of the name:
  only the name and the letter in the mark changed.
- Building the mark from one solid shape and one cut, then rendering it at
  16 px before calling it done.

## Prevention rules

- Run the conflict check first, for every finalist: npm, domains across
  `.com`, `.dev`, `.sh`, `.io`, `.ai`, and a search on G2 or Capterra for
  software with the same name. Do it before writing any identity.
- Ask for all naming requirements up front: audience, tone, metaphor, and
  constraints such as enterprise or trademark class.
- Design a logo at 16 px and in one color first, then scale up.
- Keep the code rename behind the gates in the
  [rename spec](../specs/01a108ce87cf7694-graven-rename.md): trademark search,
  registrations, merged open pull requests, and working npm publishing.
