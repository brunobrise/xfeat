---
date: 2026-06-17
type: failure
status: validated
related_spec: ../specs/019f5e2f0f01a6b1-plantuml-diagram-generation-quality.md
---

# PlantUML Diagram Generation Failure

## Summary

The first theme pass produced PlantUML warning banners in generated SVGs and a
manual layout hint made the widest overview diagram wider. The final fix removed
unsupported theme keys, reverted the unhelpful hint, and added verification
commands so the failure is easy to catch next time.

## Impact

- Generated SVGs briefly contained PlantUML warning text.
- A hidden-anchor layout experiment increased the high-level architecture
  diagram width instead of improving it.
- Some generated diagrams had edge bundles caused by one-arrow-per-object
  fan-outs where package-level relationships were clearer.
- Previous transparent/dark-mode styling conflicted with the explicit white
  background requirement.
- SVG consumers can ignore root `<svg>` CSS background styles, leaving the canvas
  dark even when PlantUML emits `background:#FFFFFF`.

## Cause Chain

- Theme settings copied from older PlantUML examples included keys that the
  current renderer reported as warnings.
- Layout hints were added before proving they improved final SVG dimensions and
  scan quality.
- Prior output optimized for theme adaptation, while this task required fixed
  professional white-background diagrams.

## Corrective Actions

- Use `professional-theme.iuml` as the only shared styling surface.
- Use `npm run render:diagrams` so every render also inserts a full-canvas white
  rectangle.
- Prefer `linetype polyline` unless a specific diagram proves `ortho` is better.
- Consolidate fan-out/fan-in relationships at package level when individual
  arrows create a routing bundle.
- Run a warning grep after each render:
  `rg -n 'Please use|prefers-color-scheme|backgroundColor transparent'`.
- Validate every SVG with `xmllint --noout`.
- Keep before/after dimensions for any manual layout hint and revert hints that
  make a diagram larger or less scannable.

## Follow-up Policy

Future diagram-generation changes must update the spec when changing rendering
policy and add a new success or failure story when a reusable lesson is found.
