# Refresh checklist

The `a11y-flow-audit` skill bakes in references to external specs (WCAG, WAI-ARIA, ARIA Authoring Practices Guide, WAI's authoring guide for page structure). Run this refresh quarterly, or when a major spec revision ships.

## Sources

- https://www.w3.org/TR/WCAG21/ — WCAG 2.1 criteria
- https://www.w3.org/TR/WCAG22/ — WCAG 2.2 (when targeted)
- https://www.w3.org/TR/wai-aria-1.2/ — WAI-ARIA attribute and role spec
- https://www.w3.org/WAI/ARIA/apg/patterns/ — ARIA Authoring Practices Guide (pattern recipes)
- https://www.w3.org/WAI/tutorials/page-structure/ — WAI page-structure authoring guide (landmarks, headings, skip links)

## Process

1. **Check WCAG criterion URLs** in `references/wcag-criteria.md`:
   - Verify each URL still resolves to the Understanding document.
   - If a criterion has been deprecated or moved, update the URL.
   - If the project target shifts to WCAG 2.2 or 3.0, add the new criteria with flow-specific plain-English impact blurbs.
   - Pay particular attention to criteria that gained flow-specific impact notes (1.3.1, 2.4.1, 2.4.3, 2.4.6, 3.2.3, 3.2.4, 4.1.2, 4.1.3) — re-verify they are still accurate.
2. **Check APG pattern URLs** in `references/aria-patterns.md`:
   - Verify each URL still resolves.
   - If a pattern's recommended implementation has changed (e.g., roving tabindex vs `aria-activedescendant` guidance for listbox, or dialog focus-trap library recommendations), update the completeness table.
3. **Check WAI page-structure guide**:
   - If WAI's recommended landmark/skip-link patterns change, reflect the updates in `references/landmarks.md` and `references/headings.md` (skip-link section).
4. **Check WAI-ARIA attribute list**:
   - If a new attribute is added to the spec (1.2 → 1.3), consider whether flow-level rules should reference it.
   - If an attribute is deprecated, remove it from the landmark / heading / focus-flow reference files.
5. **Cross-check the shared references** against the audit skill (`~/.claude/skills/a11y-audit/references/aria-patterns.md` and `wcag-criteria.md`):
   - These are duplicated per the shared-references policy. Re-sync if both skills should move together.
   - If drift has produced divergent versions, decide whether to reconcile (easier to maintain) or keep divergent (if flow-specific additions are worth preserving). Document the decision here.
6. If the directory is under version control, commit the refresh with a dated message (e.g., `chore(a11y-flow-audit): refresh 2026-07`).

## References currently tracked

- `safety-rules.md` — 8 flow-level rules (single main, heading hierarchy, repeated-landmark labeling, modal focus discipline, skip links, tab order, name collision, live-region conflict) plus 4 component-audit carry-over rules (no unverified symbols in diffs, no invented ARIA, no predictive tool/AT claims, no editing artifacts). Self-check questions mirror the rules.
- `landmarks.md` — landmark roles, labeling rules, common mistakes, detection strategies for composed views.
- `headings.md` — heading hierarchy rules, visual-vs-level disagreement, skip-link patterns, heading-and-landmark agreement.
- `focus-flow.md` — tab-order rules, modal focus discipline (in/trap/Escape/restore), `autoFocus` guidance, route-change focus, live-region rules.
- `aria-patterns.md` — duplicated from `/a11y-audit`. 9 composite patterns (grid, menu/menubar, listbox, tree, tabs, radiogroup, combobox, dialog, disclosure) with completeness requirements, APG links, plain-language blurbs, and anti-patterns to refuse.
- `wcag-criteria.md` — duplicated from `/a11y-audit` and extended with flow-specific impact blurbs. Flow-extended criteria: 1.3.1, 2.1.2, 2.4.1, 2.4.3, 2.4.6, 3.2.3, 3.2.4, 4.1.2, 4.1.3.
- `output-format.md` — flow-specific Layer 1 Summary (scope boundary, components enumeration, cross-component dependency notes, finding groups, safely-shippable / design-blocked tables, runtime-tooling items), Layer 2 findings table with `F#` numbering, Layer 3 detailed finding with Design Decision block template and cross-component trace requirement. Includes hand-off notes to `/a11y-remediate`.

## Duplication-policy check

`aria-patterns.md` and `wcag-criteria.md` are maintained as duplicates across `/a11y-audit`, `/a11y-flow-audit`, and (for `wcag-criteria.md`) `/a11y-remediate`. On each refresh:

- Diff this skill's `aria-patterns.md` against `~/.claude/skills/a11y-audit/references/aria-patterns.md`. Intentional divergence only (flow-audit has no current divergence for this file).
- Diff this skill's `wcag-criteria.md` against `~/.claude/skills/a11y-audit/references/wcag-criteria.md`. Expected divergence: flow-specific impact notes on ~9 criteria. Any other divergence is drift — reconcile or document.

If drift becomes painful, escalate to a shared `~/.claude/shared/a11y/references/` structure (symlinks or moved files). Until then, duplicate-and-sync is the policy per the architecture spec.
