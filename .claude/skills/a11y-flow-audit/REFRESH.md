# Refresh checklist

The `a11y-flow-audit` skill bakes in references to external specs (WCAG, WAI-ARIA, ARIA Authoring Practices Guide, WAI's authoring guide for page structure). Run this refresh quarterly, or when a major spec revision ships.

## Sources

- https://www.w3.org/TR/WCAG21/ — WCAG 2.1 criteria
- https://www.w3.org/TR/WCAG22/ — WCAG 2.2 (when targeted)
- https://www.w3.org/TR/wai-aria-1.2/ — WAI-ARIA attribute and role spec
- https://www.w3.org/WAI/ARIA/apg/patterns/ — ARIA Authoring Practices Guide (pattern recipes)
- https://www.w3.org/WAI/tutorials/page-structure/ — WAI page-structure authoring guide (landmarks, headings, skip links)

## Process

1. **Shared references** (`aria-patterns.md`, `wcag-criteria.md`, `shared-discipline.md`) are canonical in `.claude/skills/a11y-audit/references/` and refreshed by that skill's REFRESH.md — including the flow-specific impact notes in `wcag-criteria.md` (1.3.1, 2.4.1, 2.4.3, 2.4.6, 3.2.3, 3.2.4, 4.1.2, 4.1.3). No local sync needed.
2. **Check WAI page-structure guide**:
   - If WAI's recommended landmark/skip-link patterns change, reflect the updates in `references/landmarks.md` and `references/headings.md` (skip-link section).
3. **Check WAI-ARIA attribute list**:
   - If a new attribute is added to the spec (1.2 → 1.3), consider whether flow-level rules should reference it.
   - If an attribute is deprecated, remove it from the landmark / heading / focus-flow reference files.
4. If the directory is under version control, commit the refresh with a dated message (e.g., `chore(a11y-flow-audit): refresh 2026-07`).

## References currently tracked

- `safety-rules.md` — 8 flow-level rules (single main, heading hierarchy, repeated-landmark labeling, modal focus discipline, skip links, tab order, name collision, live-region conflict) plus 4 component-audit carry-over rules (no unverified symbols in diffs, no invented ARIA, no predictive tool/AT claims, no editing artifacts). Self-check questions mirror the rules.
- `landmarks.md` — landmark roles, labeling rules, common mistakes, detection strategies for composed views.
- `headings.md` — heading hierarchy rules, visual-vs-level disagreement, skip-link patterns, heading-and-landmark agreement.
- `focus-flow.md` — tab-order rules, modal focus discipline (in/trap/Escape/restore), `autoFocus` guidance, route-change focus, live-region rules.
- `output-format.md` — flow-specific Layer 1 Summary (scope boundary, components enumeration, cross-component dependency notes, finding groups, safely-shippable / design-blocked tables, runtime-tooling items), Layer 2 findings table with `F#` numbering, Layer 3 detailed finding with Design Decision block template and cross-component trace requirement. Includes hand-off notes to `/a11y-remediate`.

Shared (read from `.claude/skills/a11y-audit/references/`, refreshed there): `aria-patterns.md`, `wcag-criteria.md` (includes the flow-specific impact blurbs), `shared-discipline.md`.
