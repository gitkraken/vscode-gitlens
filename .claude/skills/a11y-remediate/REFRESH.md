# Refresh checklist

The `a11y-remediate` skill references external specs (WCAG, WAI-ARIA) and consumes outputs from `/a11y-audit`. Run this refresh when the audit's output format changes or quarterly.

## Process

1. **Hand-off compatibility check** — confirm `/a11y-audit`'s Layer 1 Summary still produces: scope boundary, plain-English status, fix confidence breakdown (with design-blocked vs technically-uncertain split), WCAG criteria affected, issue groups, safely-shippable-now and design-blocked tables, per-P0 reproduction recipes, items requiring runtime tooling. If the audit's output format drifts, update `references/output-format.md` (Section 3 template) and the detection spine Step 1.

2. **Shared reference** — `wcag-criteria.md` is canonical in `.claude/skills/a11y-audit/references/` and refreshed there. No local copy or sync needed.

3. **Update `staffing-translation.md` if velocity norms change** — if the industry or org's "engineer-days to sprint" conventions shift, update the formula.

4. If under version control, commit with dated message (e.g., `chore(a11y-remediate): refresh 2026-07`).

## References currently tracked

- `staffing-translation.md` — eng-days → sprints, parallelization rules, multi-product coordination
- `customer-framing.md` — three-template customer status, PM/VP internal language, what NOT to claim
- `compliance-rollup.md` — cross-audit WCAG state, three honest statements, scorecard template
- `deferral-risk.md` — user-harm vs commercial risk split, three scenarios, partial-ship warnings
- `critical-path.md` — design decisions as serial blockers, forwardable decision message template
- `output-format.md` — 10-section proposal structure, provenance rules

Shared (read from `.claude/skills/a11y-audit/references/`, refreshed there): `wcag-criteria.md`.
