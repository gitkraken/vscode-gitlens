# Safety Rules — Flow-Level Fixes the Skill Must Never Emit

A flow audit proposes structural changes to a view: landmarks added, headings renumbered, focus handlers inserted, live regions consolidated. Each of these changes is visible to every user of the view — sighted, AT, keyboard-only — and a naive fix can create a NEW accessibility bug that affects more people than the original. **"No ARIA is better than bad ARIA"** applies with equal force at the flow level: a broken landmark structure, a focus trap with no exit, or a colliding live region is worse than the gap it was meant to close.

The eight rules below are the load-bearing discipline for flow audits. If a Fix would require one of the banned patterns, either bundle the missing piece, escalate Risk to High, or convert the Fix to a Design Decision block.

---

## Rule 1 — Single `<main>` per view

A view has exactly one `<main>` landmark. Two `<main>`s in the same view is a spec violation (WCAG 1.3.1, WAI-ARIA), and screen readers either pick one arbitrarily or flatten the structure. Fix can never propose "add a `<main>` here" without verifying that no other `<main>` exists in the composed tree. Multiple candidate regions? Pick one; the others become `role="region"` with accessible names, or `<section>` with `aria-labelledby`, or `<aside>`.

**Why it matters:** the `<main>` jump is the fastest-path shortcut most screen-reader users reach for. Two `<main>`s mean the shortcut can't resolve.

**Example of violation:** A route renders `<AppShell><main>...</main></AppShell>` and the inner page renders its own `<main>` inside the shell's main. Proposing "add `<main>` to the page component" without inspecting the shell creates the double-main.

**Self-check:** Before proposing a new `<main>`, have you enumerated every rendered component in the view and confirmed none of them already render one?

---

## Rule 2 — Heading hierarchy unbroken (no h1 → h3 skips)

Heading levels are sequential. A view has exactly one `<h1>` (per current convention — WCAG doesn't strictly require this, but flow audits treat it as a default for single-page views). Headings descend by one level at a time: `<h1>` → `<h2>` → `<h3>`. Skipping from `<h1>` directly to `<h3>` breaks the tree screen-reader users navigate with the H-key shortcut.

**Fix can never:** propose a heading level change in one component without checking the heading levels of sibling and descendant components in the same view. Changing `<h3>` to `<h2>` inside `<Sidebar>` may create a new collision with another `<h2>` that happens to render adjacent.

**Why it matters:** screen-reader users press H to jump heading-to-heading. A broken hierarchy means "next heading" takes them somewhere inconsistent.

**Example of violation:** Recommending a component change its `<h3>` to `<h2>` because the view has no `<h2>`, without noticing that the view also has a `<ComponentB>` that renders `<h2>`s, and the "missing" `<h2>` is deliberately `<h3>` because it nests under `<ComponentB>`'s `<h2>`.

**Self-check:** Have I enumerated every heading level in the composed view and verified the proposed change preserves the tree?

---

## Rule 3 — Every repeated landmark labeled

If a view has two or more landmarks of the same role (two `<nav>`s, two `<aside>`s, two `role="region"`s), each of the repeated landmarks MUST have a unique `aria-label` or `aria-labelledby`. Unlabeled repeated landmarks are AT-indistinguishable — the user hears "navigation, navigation" and cannot tell which is which.

**Fix can never:** add a second `<nav>` without also prescribing accessible names for BOTH the new and existing `<nav>`. The existing one may be unlabeled today because there was only one; adding a second retroactively makes the original labeling required.

**Why it matters:** landmarks are AT's table of contents for the view. Duplicates without labels collapse that ToC into noise.

**Example of violation:** Adding a sidebar `<nav>` alongside the top `<nav>`, giving the sidebar `aria-label="Sections"`, but leaving the top `<nav>` unlabeled. AT users now hear "navigation, sections" — the top one has lost its identity.

**Self-check:** For every new landmark I propose, have I also verified labels on all existing landmarks of the same role?

---

## Rule 4 — Every modal/dialog: focus in on open, restored on close

A dialog or modal MUST:

1. Move focus INTO the dialog when it opens (to a sensible first focusable element — primary action, first form field, or the dialog container itself with `tabindex="-1"` if nothing else makes sense).
2. Trap focus inside the dialog while it is open (Tab cycles within; Shift+Tab cycles back).
3. Handle Escape to close.
4. Restore focus to the triggering element (or the closest sensible fallback) when the dialog closes.

**Fix can never:** propose a focus-in without also prescribing focus-out. A dialog that pulls focus in but doesn't restore it strands the user — their place in the page is lost, and they must re-navigate from the top every time a dialog closes.

**Why it matters:** focus restoration is the contract between the modal and the user's mental map of the page. Break it and the page becomes unnavigable with a keyboard.

**Example of violation:** Proposing `dialogRef.current?.focus()` on open without a corresponding `triggerRef.current?.focus()` on close, or proposing Escape-to-close without preserving the trigger reference to restore to.

**Self-check:** Does my Fix specify (a) the focus target on open, (b) the focus trap implementation or library, (c) Escape handling, and (d) the restore target on close? All four are required — any partial fix escalates to `Needs design`.

---

## Rule 5 — Skip links when >1 landmark

When a view has more than one landmark (any combination of `<header>` + `<nav>` + `<main>` + `<aside>` + `<footer>`), keyboard-only users need a skip link pointing to the primary content — typically `<a href="#main">Skip to main content</a>` as the first focusable element in the DOM, visible on focus, targeting `<main id="main" tabindex="-1">`.

**Fix can never:** add a landmark that increases the view's landmark count past 1 without also verifying (or adding) a skip link. Going from 1 landmark to 2+ landmarks creates a new 2.4.1 Bypass Blocks failure if the skip link wasn't already there.

**Why it matters:** without a skip link, a keyboard user who loads the page must Tab through every nav item before reaching content. On every page load.

**Example of violation:** Adding `<aside>` to a page that currently has only `<main>`, without also adding a skip link or verifying one exists. Single-landmark views don't need skip links; multi-landmark views do.

**Self-check:** After applying this Fix, will the view have more than one landmark? If yes, does the view (or will the Fix include) a skip link targeting the primary content landmark?

---

## Rule 6 — Tab order matches visual reading order

The Tab sequence through focusable elements MUST match the visual reading order a sighted user would expect based on the view's layout and reading direction. Positive `tabindex` values (anywhere > 0) are an anti-pattern — they reorder focus globally and almost always produce a sequence no human would predict.

**Fix can never:** propose a positive `tabindex` to "fix focus order." The correct fix is to reorder the DOM, not to override focus order with numbers. CSS reordering (`order`, `flex-direction: row-reverse`, `grid-template-areas`, portals) that creates a visual-vs-DOM mismatch is the source of 2.4.3 bugs — the fix is to restructure the DOM, not to paper over with tabindex.

**Why it matters:** focus order is how keyboard users understand the page. An unexpected Tab sequence disorients every keyboard user on every interaction.

**Example of violation:** A two-column layout where CSS reverses the visual order (`flex-direction: row-reverse`) but the DOM is left-to-right. Proposing `tabIndex={2}` on the visually-first column and `tabIndex={1}` on the visually-second is banned. The fix is to reorder the DOM and drop the CSS reverse.

**Self-check:** Does my Fix introduce any `tabindex > 0`? If yes, I must escalate to Design Decision — the correct fix is structural, not a tabindex patch.

---

## Rule 7 — Composed components' accessible names don't collide

When two or more components render into the same view, their accessible names (labels on buttons, regions, landmarks) MUST be distinguishable. Two buttons with `aria-label="Close"` in the same view — one for a modal, one for a toast — sound identical to screen-reader users, and the user cannot tell which close they are about to activate.

**Fix can never:** add a label ("Close", "Save", "Submit") to a component without checking whether another rendered component uses the same label. If collision exists, the Fix MUST specify disambiguating language for at least one of them (e.g., "Close dialog", "Close notification").

**Why it matters:** accessible names are how AT users identify controls. Collisions make the page ambiguous.

**Example of violation:** Proposing `aria-label="Save"` on a settings panel's submit button, when the view also contains a header "Save" button for a different entity. Screen-reader users hear "Save button, Save button" and can't disambiguate without additional exploration.

**Self-check:** Have I grep-checked or logically enumerated the other rendered components in this view for name collisions with the label I'm adding?

---

## Rule 8 — Live regions: single owner per announcement type; no races

For a given view, there should be at most one `aria-live="polite"` region and at most one `aria-live="assertive"` region with a clear owner. Two components each announcing to their own polite region, at the same time, produces a race — AT reads one and drops the other, or reads both in undefined order. The fix is to centralize announcements to a single flow-level region, or to stagger announcements cleanly.

**Fix can never:** add a new `aria-live` region to a component without checking for existing live regions in the composed view. Two polite regions firing simultaneously is a NEW 4.1.3 failure.

**Why it matters:** live regions are the only programmatic channel for state announcements to AT. Contention on that channel loses information.

**Example of violation:** A form component has its own `aria-live="polite"` for validation messages. A sibling toast component adds its own `aria-live="polite"` for success confirmations. When a validation error happens at the same time as a toast, one of them is silently dropped. The fix is a single view-level live region with message coordination, or one polite + one assertive with clear ownership rules.

**Conditional-mount anti-pattern (call out explicitly):** A live region that lives inside a state branch — `role="status"` on a skeleton span that only renders while loading, or an `aria-live` container inside an `{error && <ErrorBanner>}` ternary — mounts into the DOM AT THE SAME MOMENT its content changes. AT may not observe the mutation because the region did not exist prior to the update. Effective silence for screen-reader users.

- **Wrong:** `{loading ? html\`<span role="status">Loading</span>\` : html\`<div>${content}</div>\`}` — the region disappears once data arrives, and only existed while loading.
- **Right:** `<div role="status" aria-live="polite">${loading ? 'Loading' : ''}</div>` — region is stable at the landmark/view level; only its text content changes. Persist across every state transition the region is meant to cover.

**Self-check:** Does the component I'm editing own its own live region? If yes, does the composed view have other live regions? If yes, are their announcement types and cadences coordinated, or am I creating a race? **Additionally: does any live region in this flow get conditionally rendered based on state?** If yes, the Fix must either promote the region to a persistent ancestor OR mark the finding as a conditional-mount anti-pattern with the Right-vs-Wrong contrast above.

---

## Self-check before emitting any Fix

Before writing any `Fix` field, the skill MUST internally answer these questions. If any answer is "no" or "not sure," the Fix must be bundled, escalated, or converted to a Design Decision block:

1. Does this Fix propose `<main>` or change landmark count? Have I verified no duplicate `<main>` in the composed view? (Rule 1)
2. Does this Fix change a heading level? Have I enumerated sibling/descendant heading levels in the composed view? (Rule 2)
3. Does this Fix add a landmark that duplicates an existing role? Have I prescribed accessible names for ALL instances? (Rule 3)
4. Does this Fix touch modal focus? Have I specified focus-in target, trap mechanism, Escape handling, AND focus restore target? (Rule 4)
5. Does this Fix push the view over 1 landmark? Have I verified or added a skip link? (Rule 5)
6. Does this Fix introduce any positive `tabindex`? (Rule 6 — banned; convert to Design Decision.)
7. Does this Fix add or change an accessible name? Have I checked for collisions with other rendered components? (Rule 7)
8. Does this Fix add a live region? Have I verified no conflict with existing live regions in the composed view? (Rule 8)

Additionally, the component-level rules that still apply at the flow level:

9. No unverified symbols in code diffs — if a Fix references a CSS class, constant, helper, or translation key that isn't cited as existing in the codebase, tag `[unverified: X]` AND drop Fix Confidence to Low with a Design Decision block.
10. No invented ARIA attributes — only attributes in the WAI-ARIA spec.
11. No predictive claims about tools or AT output — cite WCAG criteria, do NOT predict what axe-core, NVDA, or VoiceOver will announce at runtime.
12. No editing artifacts ("Actually,", "Re-graded,", "On reflection,") — rewrite the section cleanly if the grade changes.
13. **Dependent-finding fixes must be conditional, not prescribed.** If a finding's Fix depends on the outcome of another unresolved finding (design-blocked or Low Fix Confidence) in the same audit, the Fix field MUST be expressed as conditional alternatives (Option A if the upstream decision goes one way / Option B if it goes the other), NEVER as a single prescribed code path. A Medium-confidence Fix may not ship a step-by-step code diff that presumes the answer to an upstream design question. If the upstream finding is resolved before this audit lands, the conditional Fix collapses to a single prescribed path at that point — not before.

If any answer is "no" or "not sure," either bundle the missing piece, escalate Effort/Risk to `L / High`, or convert the Fix to a Design Decision block per `output-format.md`.
