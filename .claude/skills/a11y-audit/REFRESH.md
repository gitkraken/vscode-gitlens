# Refresh checklist

The `a11y-audit` skill bakes in references to external specs (WCAG, WAI-ARIA, ARIA Authoring Practices Guide). Run this refresh quarterly, or when a major spec revision ships.

## Sources

- https://www.w3.org/TR/WCAG21/ — WCAG 2.1 criteria
- https://www.w3.org/TR/WCAG22/ — WCAG 2.2 (when targeted)
- https://www.w3.org/TR/wai-aria-1.2/ — WAI-ARIA attribute and role spec
- https://www.w3.org/WAI/ARIA/apg/patterns/ — ARIA Authoring Practices Guide (pattern recipes)

## Process

1. **Check WCAG criterion URLs** in `references/wcag-criteria.md`:
   - Verify each URL still resolves to the Understanding document.
   - If a criterion has been deprecated or moved, update the URL.
   - If the project target shifts to WCAG 2.2 or 3.0, add the new criteria.
2. **Check APG pattern URLs** in `references/aria-patterns.md`:
   - Verify each URL still resolves.
   - If a pattern's recommended implementation has changed (e.g., roving tabindex vs `aria-activedescendant` guidance), update the completeness table.
3. **Check WAI-ARIA attribute list**:
   - If a new attribute is added to the spec (1.2 → 1.3), consider whether to update Rule 5 guidance.
   - If an attribute is deprecated, add a call-out in `framework-specific.md` if commonly seen in legacy code.
4. **Update `framework-specific.md`** only when a framework ships a new version with changed a11y idioms (e.g., React's `aria-*` prop handling, Svelte's a11y lint rules).
5. If the directory is under version control, commit the refresh with a dated message (e.g., `chore(a11y-audit): refresh 2026-07`).

## References currently tracked

- `safety-rules.md` — 11 rules; drops Rule 12 (translation-key detection) from pre-restructure skill. Self-check questions mirror the rules.
- `aria-patterns.md` — 9 composite patterns (grid, menu/menubar, listbox, tree, tabs, radiogroup, combobox, dialog, disclosure) with completeness requirements, APG links, plain-language blurbs, and anti-patterns to refuse.
- `wcag-criteria.md` — criterion → URL map + plain-English user impact, covering ~25 commonly-cited criteria, with a list of criteria the audit cannot verify from code alone.
- `verification.md` — per-product AT pair, keyboard-only checklist, automated sanity check, no-AT fallback, per-P0 reproduction recipe template, PR conventions for AT-pending.
- `shared-component-rules.md` — Rule 8 (semantic-swap visual regression) + Rule 9 (imported wrapper analysis) in full, with examples.
- `framework-specific.md` — React, Lit, Svelte, Vue, vanilla HTML, VS Code extension sections.
- `output-format.md` — Layer 1 Summary full template (all required subsections), Layer 2 issue table, Layer 3 detailed finding, Design Decision block template, severity calibration.
