# Shared audit discipline

Canonical procedures shared by `/a11y-audit` and `/a11y-flow-audit`. Skill-specific scans (cross-component traces, focus-handoff pairs, `F` numbering) live in each skill's SKILL.md.

## Pre-finalize scan — Unverified symbols inside code the dev would copy

For every code block in Layer 3 detailed findings (tsx, jsx, html, css — anything inside triple-backticks) whose issue/finding has Fix Confidence `Medium` or `High`:

- Grep the block for common unverified-symbol patterns: `className="sr-only"`, `className="visually-hidden"`, `className="btn-reset"`, `className="skip-link"`, any `translate('...')` call, any helper / context / hook name that wasn't cited earlier in the finding.
- For each match: did you actually verify that symbol exists in the audited codebase, with a cited file path?
- If NO: either (a) verify and cite it in the finding, (b) mark it `[unverified: <symbol>]` AND drop Fix Confidence to `Low` with a Design Decision block, or (c) rewrite the fix to not depend on the symbol.

A `[unverified: ...]` tag alone is insufficient when the symbol appears inside the code diff — the developer will paste the code without reading the note below it. **The Low-confidence + Design-Decision-block conversion is mandatory in this case.**

## Pre-finalize scan — Editing artifacts

Literally grep (case-insensitive) the entire draft for these strings:

- `Actually,` / `Actually ` (as a standalone clause)
- `Re-graded` / `Re-graded:`
- `On reflection`
- `Wait —`
- `Reconsidering`
- `(changed my mind)` / `(re-grading`
- Any section that proposes one answer/grade and then rejects it within the same section (e.g., "Fix: `role="columnheader"`... but actually this would..."). Harder to grep — scan each finding's Fix field and Design Decision block for any proposal-then-walk-back structure.

For each match: **rewrite the affected section from scratch with one clean answer.** Do NOT just delete the artifact phrase; the surrounding logic was built around the walk-back and needs to be rewritten decisively.

## Pre-finalize scan — Fix Confidence / Design Decision coherence

For every Layer 3 issue/finding:

- If **Fix Confidence is `Low`**: verify the Design Decision block is present with all five fields (Decision required, Typical owner, Input needed, Options, Downstream work). If only a free-form "options" list appears, rewrite to the block template.
- If **Fix Confidence is `Medium` or `High`**: verify the Fix field contains a concrete code change AND does NOT contain "developer must verify the side effects of X", "confirm the semantic meaning/behavior of Y", or "grep consumer products to check Z". If any such handoff is present, either do the verification in the audit or drop Fix Confidence to `Low` with a Design Decision block.

## Confirmed issues vs needs-verification — strict separation

- **Confirmed issue** (goes in issue/findings table + detailed findings): you can see the defect directly in the code. Missing `alt`, missing `aria-label`, inverted boolean; at flow level: two `<nav>`s without labels, an `<h1>` → `<h3>` skip, a dialog that calls `.focus()` on open but never on close.
- **Needs-verification item** (goes ONLY in "Items Requiring Runtime Tooling"): you suspect a problem but cannot confirm from code alone. Contrast ratios, runtime focus behavior, tooltip keyboard accessibility in third-party components, tab order with portals or CSS reordering, live-region announcement timing.

**The test:** if a developer would need to open a browser to confirm the problem exists, it's a needs-verification item, NOT a confirmed issue. Do not put it in the issue table.
