---
name: a11y-flow-audit
description: Use to audit a page, view, or composed flow for WCAG 2.1 AA compliance at the composition level - landmarks, heading hierarchy, tab order across components, focus handoff on modal open/close, live-region conflicts. Scope is page/view, NOT component internals. Safety-first - refuses to emit fixes that would create a new a11y bug. For single-component audits use /a11y-audit; for cross-program planning use /a11y-remediate.
---

# A11y Flow Audit

Audit the COMPOSITION of a view for WCAG 2.1 AA compliance. Identify issues that only emerge when components compose: broken landmark structures, heading hierarchies that skip levels, tab orders that don't match visual layout, modal focus handoffs that strand users, live regions that race.

**Scope:** a page, route, webview, or composed view. This skill does NOT audit component internals (see `/a11y-audit`) and does NOT produce remediation plans, staffing estimates, or customer-facing commitments (see `/a11y-remediate`).

**Audience:** engineer + designer. Findings are specific enough for an engineer to fix, but framed for a designer to understand the composition problem and contribute to resolution when the fix requires a design decision.

## How to use this skill

1. Run the detection spine (below) before reading components in depth.
2. Emit the mandatory calibration one-liner so miscalibration surfaces early.
3. Read the relevant reference leaves per the routing table.
4. Write the audit following `references/output-format.md` layer by layer.
5. Run the Safety Self-check (all 8 flow rules + component-carry-over rules) before emitting any Fix field.
6. Run the Pre-finalize pass before writing the report to disk.

## Detection spine

Run once per audit. Cache mentally for the session.

### Step 1 — View boundary

Identify what defines the view's edges:

- **React Router route** — `<Route path="...">` in the router config, or a route file in a file-based routing system (Next.js, Remix, TanStack).
- **VS Code webview** — a webview registered with `vscode.window.createWebviewPanel(...)` or a `WebviewViewProvider`. The webview's HTML entry point defines the view.
- **Svelte / SvelteKit layout + page** — `+layout.svelte` wraps `+page.svelte`; the composed unit is the view.
- **Single HTML page** — one `.html` file; the file IS the view.
- **Vue Router route** / **Angular route** — similar to React Router.
- **Modal / drawer hosted at a route** — treat the modal as its own micro-view if it takes over focus and has its own composition (header + body + actions).

Write the view's identifier as the audit's subject. Example: "View: `src/routes/dashboard/settings`."

### Step 2 — Component tree enumeration

List every component the view renders, including shared-shell / layout components. Group into:

- **App shell / layout** — `<AppShell>`, `<Layout>`, `+layout.svelte`, etc. — components the view inherits but doesn't own directly.
- **View-owned components** — rendered directly by the view's entry point.
- **Nested or conditionally-rendered components** — rendered by view-owned components, or rendered only under certain state (modals, popovers, error states).

For each, note the file path. The enumeration is authoritative; every finding will reference one or more of these components.

### Step 3 — Existing landmarks

Grep the view's composed tree for landmarks:

- `<main>`, `<nav>`, `<aside>`, `<header>`, `<footer>`
- `role="region"`, `role="banner"`, `role="contentinfo"`, `role="complementary"`, `role="search"`, `role="navigation"`, `role="main"`

For each, note:

- The component that renders it.
- Whether it has `aria-label` / `aria-labelledby`.
- Whether it's nested inside another landmark.

### Step 4 — Heading range

Grep for `<h1>` through `<h6>` and any Heading / Title / SectionHeader components in the view's composed tree. Write the sequence in DOM order: `h1, h2, h2, h3, h2, h4`. Note which component renders each.

### Step 5 — Focus-management patterns

Grep for:

- `focus-trap`, `react-focus-lock`, `@radix-ui/react-dialog`, `<dialog>` with `showModal()` — focus-trap infrastructure.
- `.focus()` calls — explicit focus moves.
- `autoFocus` prop / `autofocus` attribute — declarative initial focus.
- `useRef` / `ref=` + focus patterns.
- `aria-live`, `role="status"`, `role="alert"` — live regions.
- `tabindex=` — especially positive values (anti-pattern).

Note count and kind for the calibration line.

### Mandatory calibration one-liner

Before writing the audit body, emit this exact one-liner (replacing the placeholders):

> View: {path}. Components: {count, top-level names}. Existing landmarks: {list}. Heading range: {h1-hN or "none"}. Focus-management patterns: {count and kind}.

Non-negotiable. Surfaces miscalibration before it corrupts output. A reader can interrupt and correct.

## Load-bearing rules (always apply)

Full rules live in `references/safety-rules.md`. Read them before emitting any Fix. Compressed list for quick scan:

1. **Single `<main>` per view** — never propose a new `<main>` without verifying no other `<main>` exists in the composed tree. (→ `safety-rules.md`, `landmarks.md`)
2. **Heading hierarchy unbroken** — no `<h1>` → `<h3>` skips; heading changes in one component must be checked against every other heading in the composed view. (→ `safety-rules.md`, `headings.md`)
3. **Every repeated landmark labeled** — two `<nav>`s need two unique `aria-label`s; adding a second landmark retroactively requires labeling the first. (→ `safety-rules.md`, `landmarks.md`)
4. **Modal focus: in on open, trap while open, Escape to close, restore on close** — all four required. Partial fixes are banned; escalate to Design Decision. (→ `safety-rules.md`, `focus-flow.md`, `aria-patterns.md`)
5. **Skip links when >1 landmark** — adding a landmark that pushes the view past 1 total landmark requires a skip link. (→ `safety-rules.md`, `headings.md`, `focus-flow.md`)
6. **Tab order matches visual reading order; no `tabindex > 0`** — fix the DOM, never paint over with positive tabindex. (→ `safety-rules.md`, `focus-flow.md`)
7. **Composed components' accessible names don't collide** — check for duplicates before adding any `aria-label`. (→ `safety-rules.md`)
8. **Live regions: single owner per announcement type; no races** — at most one polite and one assertive region per view. (→ `safety-rules.md`, `focus-flow.md`)

Also apply the component-audit carry-over rules:

- **No unverified symbols in code diffs** — `[unverified: X]` in a code block forces Fix Confidence to Low with a Design Decision block.
- **No invented ARIA attributes** — WAI-ARIA spec only.
- **No predictive claims about tools or AT runtime output** — cite WCAG criteria; do not predict axe-core, NVDA, VoiceOver output.
- **No editing artifacts in output** — rewrite cleanly; no "Actually,", "Re-graded,", "On reflection,".
- **Dependent-finding fixes are conditional** (Rule 13) — if a Fix depends on another unresolved finding's decision, render as Option A / Option B alternatives, never a single prescribed path.

## When to load which reference

| Situation                                                                                               | Read                                                                      |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Enumerating landmarks or flagging landmark-structure issues                                             | `landmarks.md` + `safety-rules.md`                                        |
| Checking heading sequence or proposing heading-level changes                                            | `headings.md` + `safety-rules.md`                                         |
| Any modal, dialog, drawer, or focus-handoff finding                                                     | `focus-flow.md` + `safety-rules.md` + `aria-patterns.md` (dialog pattern) |
| Tab-order findings — CSS reordering, portals, positive tabindex                                         | `focus-flow.md` + `safety-rules.md`                                       |
| Live-region conflicts or announcement coordination                                                      | `focus-flow.md` + `safety-rules.md`                                       |
| Skip link present / missing / misconfigured                                                             | `headings.md` (skip-link patterns) + `landmarks.md`                       |
| About to propose an ARIA role from a composite pattern (dialog, menu, listbox, tabs, grid, tree)        | `aria-patterns.md` + `safety-rules.md`                                    |
| Writing the Layer 1 Summary (scope boundary, plain-English status, WCAG section, cross-component notes) | `output-format.md` + `wcag-criteria.md`                                   |
| Writing the Layer 2 findings table or Layer 3 detailed finding                                          | `output-format.md`                                                        |
| Looking up a WCAG criterion URL or plain-English impact                                                 | `wcag-criteria.md`                                                        |

If a task spans multiple situations (typical — most flow audits involve landmarks + headings + focus), load all matching references.

**Shared references:** `aria-patterns.md` and `wcag-criteria.md` are canonical in `.claude/skills/a11y-audit/references/` — read them from there. All other references are local to this skill's `references/`.

## Severity calibration

| Severity | Test                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| P0       | AT / keyboard user cannot complete a core workflow on this view. Any workaround → not P0. |
| P1       | Core workflow works but with major friction or confusion.                                 |
| P2       | Works with difficulty; non-core paths may be blocked.                                     |
| P3       | Technically non-compliant but low real-world impact.                                      |

Apply these adjustments after the initial grade:

- Can user complete the workflow on this view? No → P0/P1. Yes → P2/P3.
- Core vs peripheral workflow → bump up / down one.
- Reasonable workaround exists → bump down one.
- Affects every route that uses this shell / layout → bump up one (systemic).

## Self-check before emitting any Fix

Answer these before writing each `Fix` field (full text in `safety-rules.md`):

1. Does this Fix propose `<main>` or change landmark count? Have I verified no duplicate `<main>` in the composed view? (Rule 1)
2. Does this Fix change a heading level? Have I enumerated sibling/descendant heading levels in the composed view? (Rule 2)
3. Does this Fix add a landmark that duplicates an existing role? Have I prescribed accessible names for ALL instances? (Rule 3)
4. Does this Fix touch modal focus? Have I specified focus-in, trap, Escape, AND restore target — all four? (Rule 4)
5. Does this Fix push the view over 1 landmark? Have I verified or added a skip link? (Rule 5)
6. Does this Fix introduce any positive `tabindex`? (Rule 6 — banned; convert to Design Decision.)
7. Does this Fix add or change an accessible name? Have I checked for collisions with other rendered components? (Rule 7)
8. Does this Fix add a live region? Have I verified no conflict with existing live regions in the composed view? (Rule 8)
9. Does the code diff contain any unverified symbol (CSS class, helper, translation key) not cited as existing in the codebase?
10. Is every ARIA attribute in the WAI-ARIA spec?
11. Am I making any predictive claim about runtime tool or AT output?
12. Does my draft contain any editing-artifact phrases?
13. Does this Fix depend on the outcome of another unresolved finding in this audit? If yes, is the Fix expressed as conditional alternatives (Option A if X / Option B if Y), not a single prescribed path? (Rule 13)

If any answer is "no" or "not sure," either bundle the missing piece, escalate Effort/Risk to `L / High`, or convert the Fix to a Design Decision block per `output-format.md`.

## Pre-finalize pass (MANDATORY — before writing the report to disk)

The per-Fix self-check catches issues as you write them. This pre-finalize pass catches what the per-Fix check missed. Not optional.

First run the two shared scans in `.claude/skills/a11y-audit/references/shared-discipline.md` (full procedures there) over the complete draft:

1. **Unverified symbols inside code diffs**
2. **Editing artifacts**

Then run these flow-specific scans:

### Scan — Cross-component claims name both sides

Every finding whose scope is "cross-component" (Layer 3 Components-involved field lists 2+ components) MUST have a Cross-Component Trace that:

- Names each component by its exact component name AND file path.
- Identifies the specific elements / attributes / handlers in each that participate in the composition problem.

Grep the draft for abstractions like "Component A", "Component B", "ComponentOne", "the first component" in Layer 3 findings — these are placeholder phrases, not concrete references. If found, rewrite the finding to name the components explicitly.

Also grep for generic "the modal doesn't restore focus" / "two components announce at once" phrasings without concrete component identities. These must be rewritten with specific component names.

### Scan 4 — Focus-handoff claims trace to a specific component pair

For every finding tagged "Focus flow" in Layer 3:

- Does the finding name the component that INITIATES the focus move (the trigger, the dialog, the route change)?
- Does the finding name the component (or fallback element) that SHOULD RECEIVE focus on close / transition?
- Is the trigger element reference concrete — a ref name, a trigger component, or a DOM selector — not "the triggering element" in abstract?

If the finding uses abstract phrasing ("restore focus to the triggering element") without pinning down which element, rewrite it with specific references.

### Scan — Fix Confidence / Design Decision coherence

Run the shared coherence scan from `.claude/skills/a11y-audit/references/shared-discipline.md` over every Layer 3 finding.

### Scan — Finding numbering uses `F` prefix

Grep for finding identifiers in Layer 2, Layer 3, and any cross-references. Every flow finding MUST use `F1, F2, F3, ...` (not `#1, #2, #3, ...`). The `F` prefix distinguishes flow findings from component findings in cross-audit remediation rollups.

If the draft uses `#` numbering, replace with `F` throughout. Cross-reference consistency matters — `F2` in the Summary must match `F2` in the table and the Layer 3 finding.

### If any scan finds something

Fix it before writing the file.

---

After all scans pass, emit the calibration one-liner and then the full report.

## Ambiguity handling

| Dimension                     | Ambiguous →                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| View boundary                 | Report as best-match + flag uncertainty (e.g., "treating the route `/settings` and its child modals as one view") |
| Component tree completeness   | Enumerate what you can; flag remaining uncertainty (portals you couldn't resolve, conditional branches)           |
| Whether a fix is safe to emit | Default to Medium Fix Confidence; the Risk/Confidence fields communicate uncertainty                              |
| Severity                      | Apply the decision guide; when genuinely torn between two levels, pick the lower and note why                     |
| Tab order at runtime          | Never claim confirmation from static analysis; flag as "Items Requiring Runtime Tooling"                          |

Never fabricate. When you don't know, say so in the output, don't guess silently.

## Thoroughness

Audit every landmark, every heading, every focus-management pattern, and every live region in the composed view. Do not skip issues because the view has "enough" findings. Common categories easy to overlook at the flow level:

- Shell / layout-inherited landmarks the view doesn't own
- Headings inside imported components you didn't write
- Focus restoration missing for dialogs that dismiss their own trigger
- Live regions mounted conditionally (created the moment they fire, which drops the announcement)
- Skip-link targets that aren't properly set up (no `tabindex="-1"`)
- `<header>` / `<footer>` nesting that produces multiple banner/contentinfo candidates

Also: if the view uses a shared shell, audit the shell for its landmark and skip-link contributions — a view may inherit a broken shell and the fix belongs in the shell, not the view.

## Confirmed issues vs needs-verification — strict separation

Per `.claude/skills/a11y-audit/references/shared-discipline.md`: confirmed issues (composition defect visible directly in the code — unlabeled duplicate `<nav>`s, heading skips, focus-in without restore) go in the findings table; needs-verification items (a browser is required to confirm — runtime tab order with portals, focus landing position, live-region timing) go ONLY in "Items Requiring Runtime Tooling."

## Hand-off to `/a11y-remediate`

The Layer 1 Summary of this audit is consumed by `/a11y-remediate` identically to how component audits are consumed. The structured sections remediate expects from a flow audit are:

- **Scope boundary** — the bounded claim this audit makes. Remediate cites it verbatim in customer framing.
- **Components in scope** — the enumerated list of components covered. Remediate uses this to identify "audited vs unaudited surface."
- **Plain-English flow status** — one to two sentences for customer / VP framing.
- **Total findings + P0/P1/P2/P3 counts** — feeds compliance rollup.
- **Fix Confidence breakdown** (with design-blocked vs technically-uncertain split) — feeds staffing ask.
- **Rough sizing (engineer-days)** — feeds staffing translation.
- **WCAG criteria affected** (three states: currently failing / addressable / runtime-only) — feeds compliance rollup.
- **Cross-Component Dependency Notes** — flow-specific; remediate elevates these in critical-path analysis because cross-component changes are higher-coordination-risk.
- **Finding Groups (Must Ship Together)** — feeds sprint planning (groups cannot be split across sprints).
- **Safely Shippable Now + Design-blocked tables** — direct inputs to sprint plans.
- **Items Requiring Runtime Tooling** — surfaced in remediate's "what this CANNOT answer" section.

**Numbering contract:** flow audits use `F1, F2, F3, ...`. Component audits use `#1, #2, #3, ...`. Remediate disambiguates with `{audit-name}:{F#-or-#N}`. Do not break this convention.

**Severity notation compatibility:** flow findings and component findings use the SAME P0/P1/P2/P3 notation so remediate's compliance rollup can aggregate by severity across both audit types. The Layer 2 column for flow findings (`F#`) differs from component findings (`#`) in the identifier, but the severity column is identical in meaning and notation.

If this contract is broken (e.g., flow audit uses `#1` or omits the Components-in-scope enumeration), remediate's extraction will degrade silently. Preserve the contract.

## Output location

Flow audits are written to `audits/{view-name}-flow-audit.md` (or wherever the user specifies). The `-flow-audit` suffix distinguishes them from component audits (`{target}-audit.md`). Remediate uses the suffix to identify audit type when aggregating.
