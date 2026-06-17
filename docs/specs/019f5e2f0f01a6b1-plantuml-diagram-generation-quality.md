---
date: 2026-06-17
status: implemented
owner: codex
---

# PlantUML Diagram Generation Quality

## Context

`examples/nanobot-features.md` embeds generated SVG diagrams from
`examples/diagrams/019e9799c745d04d`. Those diagrams must remain readable in
GitHub, browsers, and print/PDF exports without dark-mode inversions, warning
banners, or accidental transparent backgrounds.

Research sources:

- PlantUML layout docs recommend `nodesep`, `ranksep`, `linetype polyline` or
  `linetype ortho`, and careful use of `together`/hidden links for manual layout
  hints: https://plantuml.com/layout-engines
- PlantUML skinparam docs cover white/transparent backgrounds, shadowing,
  font/color customization, and sequence message alignment:
  https://plantuml.com/de/skinparam
- Google SRE postmortem guidance recommends a written record of impact,
  actions, root causes, follow-up actions, blamelessness, and repository-based
  sharing: https://sre.google/sre-book/postmortem-culture/
- Atlassian incident guidance recommends tracking action items, owners, and a
  cause chain instead of stopping at the first apparent failure:
  https://www.atlassian.com/incident-management/handbook/postmortems

## Requirements

- Every checked-in PlantUML source in
  `examples/diagrams/019e9799c745d04d/*.puml` includes the shared
  `professional-theme.iuml` file immediately after `@startuml`.
- Generated SVGs have a white `#FFFFFF` background and no `prefers-color-scheme`
  dark-mode CSS.
- Generated SVGs include a full-canvas white rectangle so renderers that ignore
  root `<svg>` CSS backgrounds still produce white output.
- Generated SVGs contain no PlantUML warning text such as `Please use`.
- Diagram theme uses portable professional defaults: Helvetica, subdued slate
  text, light surfaces, blue-gray borders/arrows, no shadows, and rectangular
  packages.
- Layout uses `nodesep` and `ranksep` to reduce crowding. `linetype polyline`
  is the default because the current architecture diagrams contain many labels
  and long object names; `ortho` may be used only after visual comparison proves
  it improves a specific diagram.
- Manual layout hints (`together`, `hidden`, direction overrides, grouped
  aliases) require before/after dimension checks and visual inspection. Do not
  keep a hint when it increases width/height or makes crossings harder to scan.
- Repeated fan-out/fan-in arrows should be consolidated into package-level
  relationships when the target package already lists the individual objects.
  This preserves architecture intent while avoiding unreadable arrow bundles.
- SVG output is regenerated from source. Do not hand-edit generated SVGs.

## Implementation

- Add `examples/diagrams/019e9799c745d04d/professional-theme.iuml`.
- Add `scripts/render-plantuml-diagrams.js` and `npm run render:diagrams` to
  regenerate diagrams and normalize the white SVG canvas.
- Update all 40 PlantUML source files to include the shared theme.
- Regenerate all 40 SVG files with PlantUML.
- Add success and failure stories so future changes inherit the same practices.

## Verification

Run these gates before committing diagram changes:

```sh
plantuml -checkonly examples/diagrams/019e9799c745d04d/*.puml
npm run render:diagrams
for file in examples/diagrams/019e9799c745d04d/*.svg; do xmllint --noout "$file"; done
rg -n 'Please use|prefers-color-scheme|backgroundColor transparent' examples/diagrams/019e9799c745d04d examples/nanobot-features.md
rg -L 'data-xfeat-white-canvas="true"' examples/diagrams/019e9799c745d04d/*.svg
```

The warning/dark-mode `rg` command should return no matches. The white-canvas
`rg -L` command should also return no files.

## Acceptance Criteria

- 40 PlantUML files render successfully.
- 40 SVG files validate as XML.
- All SVG files use a white background.
- All SVG files contain `data-xfeat-white-canvas="true"`.
- No generated SVG contains warning banners or dark-mode CSS.
- `examples/nanobot-features.md` keeps embedding SVG files, not inline diagram
  code.
