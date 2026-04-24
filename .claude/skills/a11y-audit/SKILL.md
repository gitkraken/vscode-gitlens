---
name: a11y-audit
description: Use to audit a component, file, or directory for WCAG 2.1 AA accessibility compliance. Detects ARIA anti-patterns, missing semantics, keyboard gaps, and color-only information. Safety-first — refuses to emit fixes that would create a new accessibility bug. Scope is always explicit; do not use for page-level flow or cross-program planning.
---

# A11y Audit

Audit code for WCAG 2.1 AA compliance using static analysis. Identify issues, prescribe safe fixes, enforce "no ARIA is better than bad ARIA."

**Scope:** a single file or a directory of components. This skill does NOT audit page-level flow (see `/a11y-flow-audit`) and does NOT produce remediation plans, staffing estimates, or customer-facing commitments (see `/a11y-remediate`).

## How to use this skill

1. Run the detection spine (below) before reading the code in depth.
2. Emit the mandatory calibration one-liner so miscalibration surfaces early.
3. Read the relevant reference leaves per the routing table.
4. Write the audit following `references/output-format.md` layer by layer.
5. Run the Safety Self-check before emitting any Fix field.

## Detection spine

Run once per audit. Cache mentally for the session.

### Step 1 — Framework

Inspect the target file and its imports. First match wins.

- `import from 'react'` → **React**
- `import from 'lit'` / `customElements.define` / `extends LitElement` → **Lit**
- `.svelte` extension or `import from 'svelte'` → **Svelte**
- `.vue` extension or `import from 'vue'` → **Vue**
- Plain `.html` with no framework imports → **Vanilla HTML/JS**
- Other / hybrid → name it plainly.

### Step 2 — Product type

- `package.json` with `engines.vscode` → **VS Code extension** (webview content is fully your responsibility).
- Electron / Tauri dependencies → **Desktop app**.
- `react-dom` / `vue/server-renderer` + routing libs → **Web app**.
- Package is exported as a library (`main` / `exports` / published to npm with no runnable entry) → **Shared component library**.
- Ambiguous → pick the best match and state it.

### Step 3 — Shared-library detection

If the target is in a package that is imported by multiple consumers (OR if the repo name suggests "components", "ui-kit", "shared-web-components", etc.), flag **Shared: yes, {library name}**. Shared status escalates Rule 8 (visual-regression) concern for semantic-element swaps.

### Step 4 — Locale system (governs Rule 12 note in framework-specific.md — dropped from active rules)

Grep for locale/translation files under directories matching `locale|i18n|lang|translations`. Count the number of locale file candidates (`*.json`, `*.yaml`, `*.po`, `*.ftl`). If multiple locales exist AND a Fix requires a new translation key, note that key additions touch locale files — flag effort accordingly even if the ARIA change is small.

### Step 5 — Test presence

Check for adjacent `*.test.*`, `*.spec.*`, or `__snapshots__/` — if present, note which issues involve DOM structure changes that may break tests. Don't audit the tests; just flag the intersection.

### Mandatory calibration one-liner

Before writing the audit body, emit this exact one-liner (replacing the placeholders):

> Framework: {X}. Product: {Y}. Shared lib: {yes/no[, library name]}. Locale files: {count}. Tests present: {yes, {paths} | no}.

This is non-negotiable. It surfaces miscalibration before it corrupts output. A reader can interrupt and correct.

## Load-bearing rules (always apply)

Full rules live in `references/safety-rules.md`. Read them before emitting any Fix. Compressed list for quick scan:

1. **No orphan ARIA roles** — composite patterns (grid/menu/listbox/tree/tabs/radiogroup/combobox/dialog) must ship complete. Never propose a single role from the pattern table standalone. (→ `aria-patterns.md`, `safety-rules.md`)
2. **No `tabIndex` without keyboard handlers** — focusable-but-inert is a new bug. (→ `safety-rules.md`)
3. **No container role without child roles** — `role="grid"` without rows, etc. Bundle via Issue Groups. (→ `safety-rules.md`)
4. **No unverified symbols in code diffs** — if a Fix's code contains `[unverified: X]`, Fix Confidence MUST be Low with a Design Decision block. Never paste a class/key/helper the dev can't find. (→ `safety-rules.md`)
5. **No invented ARIA** — only attributes in the WAI-ARIA spec. No `aria-valid`-style fabrications. (→ `safety-rules.md`)
6. **No `aria-label` as substitute for visible text** — visible text (with sr-only backup) is preferred. (→ `safety-rules.md`)
7. **No predictive claims about tools or AT** — "axe will flag this", "NVDA will announce X" — banned. Cite the WCAG criterion; don't predict runtime output. (→ `safety-rules.md`)
8. **Semantic-element swaps in shared components must address visual regression** — bare `<button>` replacing `<span>` without a CSS reset plan is a banned fix. (→ `shared-component-rules.md`)
9. **Fixes depending on an imported wrapper must analyze that wrapper** — open the wrapper, summarize its behavior. Third-party black box → Risk: High. (→ `shared-component-rules.md`)
10. **No editing artifacts in the output** — phrases like "Actually...", "Re-graded:", "On reflection" are banned. If you change your mind, rewrite the section cleanly. (→ `safety-rules.md`)
11. **No semantic-verification handoff in Medium/High confidence fixes** — if the Fix tells the dev to "verify runtime side effects" or "grep consumer products," the Fix is not ready. Either do the verification in the audit, or drop Confidence to Low with a Design Decision block. (→ `safety-rules.md`)

## When to load which reference

| Situation                                                                                                                                      | Read                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| About to propose any ARIA role from a composite pattern (grid, menu, listbox, tree, tabs, radiogroup, combobox, dialog)                        | `aria-patterns.md` + `safety-rules.md`  |
| Converting `<span onClick>` / `<div onClick>` / `<li>` → semantic element in a shared library                                                  | `shared-component-rules.md`             |
| Fix depends on an imported wrapper's behavior (`Icon`, `OverlayTrigger`, design-system primitive)                                              | `shared-component-rules.md`             |
| Writing Layer 1 Summary (scope boundary, plain-English status, WCAG criteria section, High-Leverage Fixes, Issue Groups, Safely Shippable Now) | `output-format.md` + `wcag-criteria.md` |
| Writing Layer 2 issue table or Layer 3 detailed finding                                                                                        | `output-format.md`                      |
| Writing Verification Playbook or Items Requiring Runtime Tooling                                                                               | `verification.md`                       |
| Auditing React code (including react-bootstrap, react-virtualized, cloneElement wrappers)                                                      | `framework-specific.md` (React section) |
| Auditing Lit / Shadow DOM code                                                                                                                 | `framework-specific.md` (Lit section)   |
| Auditing Svelte, Vue, or vanilla HTML                                                                                                          | `framework-specific.md`                 |
| Looking up a WCAG criterion URL or plain-English impact                                                                                        | `wcag-criteria.md`                      |

If a task spans multiple situations (typical — most audits involve multiple patterns), load all matching references.

## What to check

Analyze the code against these categories, mapped to WCAG 2.1 AA criteria. See `references/wcag-criteria.md` for URL and plain-English impact per criterion.

### Perceivable

- **Images and icons (1.1.1)** — `<img>` alt attributes; icon-only controls need `aria-label` or visually-hidden text; decorative images need `alt=""` or `aria-hidden="true"`.
- **Semantic structure (1.3.1)** — heading hierarchy, semantic elements (`<nav>`, `<main>`, `<aside>`, `<section>`), list markup, table markup with headers. Flag `<div>`/`<span>` used for interactive elements without ARIA roles.
- **Meaningful sequence (1.3.2)** — DOM order matches visual order; CSS `order` / grid placement should not break reading flow.
- **Color-only information (1.4.1)** — status indicated only by color with no icon/text alternative.
- **Contrast (1.4.3, 1.4.11)** — you cannot compute contrast from code alone. Flag suspicious patterns; recommend runtime verification.
- **Text resizing and reflow (1.4.4, 1.4.10)** — fixed pixel widths on text containers, fixed heights that clip, `overflow: hidden` on text containers.
- **Hover/focus content (1.4.13)** — tooltips/popovers: dismissable? hoverable? persistent?

### Operable

- **Keyboard (2.1.1, 2.1.2)** — `onClick` without `onKeyDown` on non-interactive elements; positive `tabIndex` values (anti-pattern); keyboard trap patterns.
- **Character key shortcuts (2.1.4)** — single-character shortcuts without modifier keys must be configurable.
- **Skip mechanisms (2.4.1)** — skip links / landmarks for pages with navigation.
- **Page titles (2.4.2)** — `<title>` / `document.title` / equivalent.
- **Focus order (2.4.3)** — positive `tabIndex`; CSS reordering that breaks DOM order.
- **Link purpose (2.4.4)** — "click here", "more", "read more" without `aria-label` or surrounding context.
- **Focus visibility (2.4.7)** — `outline: none` / `outline: 0` without replacement; `:focus` removed without `:focus-visible` alternative.
- **Target size (2.5.3)** — click targets hardcoded below 24x24px.

### Understandable

- **Language (3.1.1)** — `lang` attribute on root.
- **Predictable (3.2.1, 3.2.2)** — `onChange` that triggers navigation; `onFocus` that modifies the page.
- **Error handling (3.3.1-3.3.3)** — forms: associated labels, error messages linked via `aria-describedby` or `aria-errormessage`, required field indication.

### Robust

- **ARIA usage (4.1.2)** — correct ARIA roles/states/properties; roles without required attributes (e.g., `role="checkbox"` without `aria-checked`); conflicting attributes; custom interactive elements without ARIA roles.
- **Status messages (4.1.3)** — dynamic content updates need `aria-live` or equivalent.

## Severity calibration

Full definitions and decision guide in `references/output-format.md`. Quick reference:

| Severity | Test                                                              |
| -------- | ----------------------------------------------------------------- |
| P0       | AT user cannot complete a core workflow. Any workaround → not P0. |
| P1       | Core workflow works but with major friction or confusion.         |
| P2       | Works with difficulty; non-core workflows may be blocked.         |
| P3       | Technically non-compliant but low real-world impact.              |

Apply these adjustments after the initial grade:

- Can user complete the workflow? No → P0/P1. Yes → P2/P3.
- Core vs peripheral workflow → bump up / down one.
- Reasonable workaround exists → bump down one.
- Affects multiple views systemically → bump up one.

## Self-check before emitting any Fix

Answer these before writing each `Fix` field (full text in `safety-rules.md`):

1. Does this fix complete a pattern, or only part of one? (Rules 1, 3)
2. Does this fix create a focusable-but-inert element? (Rule 2)
3. Does this fix reference any unverified symbol? (Rule 4)
4. Is every ARIA attribute in the WAI-ARIA spec? (Rule 5)
5. Am I bundling everything that must ship together? (Rules 1, 3)
6. Would this fix hide information from sighted users? (Rule 6)
7. Am I making any predictive claim about tool or AT output? (Rule 7)
8. If semantic swap in a shared component, have I addressed visual-regression risk? (Rule 8)
9. If this fix depends on an imported wrapper, have I analyzed that wrapper? (Rule 9)
10. Does my draft contain any editing-artifact phrases (Actually, Re-graded, On reflection)? (Rule 10)
11. Am I handing off semantic verification inside a Medium/High confidence fix? (Rule 11)

If any answer is "no" or "not sure," either bundle the missing piece, escalate Effort/Risk to `L / High`, or convert the Fix to a Design Decision block per `output-format.md`.

## Pre-finalize pass (MANDATORY — before writing the report to disk)

The per-Fix self-check catches issues as you write them. This pre-finalize pass catches what the per-Fix check missed. It is NOT optional. Run these three scans over the completed draft before writing the file.

### Scan 1 — Unverified symbols inside code the dev would copy

For every code block in Layer 3 detailed findings (tsx, jsx, html, css — anything inside triple-backticks) whose issue has Fix Confidence `Medium` or `High`:

- Grep the block for common unverified-symbol patterns: `className="sr-only"`, `className="visually-hidden"`, `className="btn-reset"`, any `translate('...')` call, any helper function name that wasn't cited earlier in the finding.
- For each match: did you actually verify that symbol exists in the audited codebase, with a cited file path?
- If NO: either (a) verify and cite it in the finding, (b) mark it `[unverified: <symbol>]` AND drop Fix Confidence to `Low` with a Design Decision block, or (c) rewrite the fix to not depend on the symbol.

A `[unverified: ...]` tag alone is insufficient when the symbol appears inside the code diff — the developer will paste the code without reading the note below it. **The Low-confidence + Design-Decision-block conversion is mandatory in this case.** This is Rule 4's sub-rule; this scan enforces it.

### Scan 2 — Editing artifacts

Literally grep (case-insensitive) the entire draft for these strings:

- `Actually,` / `Actually ` (as a standalone clause)
- `Re-graded`
- `Re-graded:`
- `On reflection`
- `Wait —`
- `Reconsidering`
- `(changed my mind)`
- `(re-grading`
- Any section that proposes one answer/grade and then rejects it within the same section (e.g., "Fix: `role="columnheader"`... but actually this would..."). This is harder to grep — scan each finding's Fix field and Design Decision block for any proposal-then-walk-back structure.

For each match: **rewrite the affected section from scratch with one clean answer.** Do NOT just delete the artifact phrase; the surrounding logic was built around the walk-back and needs to be rewritten decisively. This is Rule 10; this scan enforces it.

### Scan 3 — Fix Confidence / Design Decision coherence

For every Layer 3 issue:

- If **Fix Confidence is `Low`**: verify the Design Decision block is present with all five fields (Decision required, Typical owner, Input needed, Options, Downstream work). If only a free-form "options" list appears, rewrite to the block template.
- If **Fix Confidence is `Medium` or `High`**: verify the Fix field contains a concrete code change AND does NOT contain "developer must verify the side effects of X", "confirm the semantic meaning of Y", or "grep consumer products to check Z". If any such handoff is present, either do the verification in the audit or drop Fix Confidence to `Low` with a Design Decision block. This is Rule 11.

### If any scan finds something

Fix it before writing the file. Do not write a draft-with-known-issues and leave them for the reader to catch.

---

After all three scans pass, emit the calibration one-liner (detection spine) and then the full report.

## Ambiguity handling

| Dimension                     | Ambiguous →                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| Framework                     | Report as best-match + flag uncertainty                                                          |
| Product type                  | Default to web app unless signals clearly indicate otherwise                                     |
| Whether a fix is safe to emit | Default to Medium Fix Confidence; the Risk/Confidence fields are how you communicate uncertainty |
| Severity                      | Apply the decision guide; when genuinely torn between two levels, pick the lower and note why    |

Never fabricate. When you don't know, say so in the output, don't guess silently.

## Thoroughness

Audit every file you read. Do not skip issues because a file has "enough" findings already. Common categories easy to overlook:

- Heading hierarchy problems
- Focus-indicator suppression without replacement
- CSS visual reordering that breaks DOM order
- Component APIs that override consumer-set attributes
- Disabled state handling across button-role vs link-role variants

If you read a shared component, audit it fully — not just the parts exercised by the current view. A shared component may have code paths that affect other consumers.

## Confirmed issues vs needs-verification — strict separation

- **Confirmed issue** (goes in issue table + detailed findings): you can see the defect directly in the code. Missing `alt`, missing `aria-label`, inverted boolean, etc.
- **Needs-verification item** (goes ONLY in "Items Requiring Runtime Tooling"): you suspect a problem but cannot confirm from code alone. Contrast ratios, focus behavior at runtime, tooltip keyboard accessibility in third-party components.

**The test:** if a developer would need to open a browser to confirm the problem exists, it's a needs-verification item, NOT a confirmed issue. Do not put it in the issue table.

## Quick reference to output format

Full templates in `references/output-format.md`. In brief, every audit emits:

- **Layer 1 — Summary**: header block + scope boundary + extrapolation warning + customer one-liner + notation legend + plain-English status + totals + fix-confidence breakdown + rough sizing + WCAG criteria affected + High-Leverage Fixes + Top Patterns + Issue Groups + Safely Shippable Now + Verification Playbook + Items Requiring Runtime Tooling.
- **Layer 2 — All Issues table**: one row per issue with severity, file, line, description, effort/risk, fix confidence, WCAG link.
- **Layer 3 — Detailed Findings**: one section per issue with WCAG criterion link, effort/risk, fix confidence, why-risk (if Med/High), user-impact statement, code, fix (or Design Decision block).
