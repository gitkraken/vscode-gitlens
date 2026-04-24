# Safety Rules — Fixes the Skill Must Never Emit

The audited code ships to users. A fix that _looks_ correct but creates a new accessibility bug is worse than no fix — it silently makes the product unusable for the very users who depend on AT. **"No ARIA is better than bad ARIA"** is a hard rule. The patterns below are banned from every `Fix` field. If a fix would require one of these, either bundle the missing piece or escalate to `Effort: L` / `Risk: High` / `Needs design`.

## Rule 1 — Pattern completeness: no orphan ARIA roles

Certain ARIA roles are only valid as part of a composite pattern. A single role from one of these patterns is never a complete fix.

See `aria-patterns.md` for the full pattern completeness table (grid, menu, menubar, listbox, tree, tabs, radiogroup, combobox, dialog) and APG links.

If the issue can only be fixed by adopting the full pattern, the `Fix` must describe the full pattern (even briefly) and the issue MUST be `Effort: L` with `Risk: High`, or escalated to `Needs design`. Do NOT propose a single role from the pattern table as a standalone fix. Do NOT propose `role="grid"` on a container without the row/cell children in the same fix or as an Issue Group.

## Rule 2 — No `tabIndex` without keyboard handlers

Adding `tabIndex={0}` to a non-interactive element makes it focusable but not operable. A focused-but-inert element is a new accessibility bug. Any fix that adds focus to a non-interactive element MUST also add:

- `onKeyDown` handling for Enter/Space (if button-like) or the pattern-appropriate keys
- A visible focus indicator — verify `:focus-visible` styling is inherited or add one
- An appropriate role (`role="button"` / `role="link"` / a pattern role)

If the keyboard handler cannot be specified in the fix, escalate to `Needs design`.

## Rule 3 — No container role without child roles

`role="grid"`, `role="menu"`, `role="menubar"`, `role="listbox"`, `role="tree"`, `role="tablist"`, `role="radiogroup"` are container roles with required children. If the children are in separate components/files, the fix MUST declare an **Issue Group** that bundles them. A standalone container-role fix is banned.

## Rule 4 — No unverified symbols in fixes

If a `Fix` references a translation key, CSS class, constant, helper, or method, the skill must either:

- Verify the symbol exists (grep the codebase) and note the file path where it lives, OR
- Tag the fix explicitly: `[unverified: <symbol> — developer must confirm or create this before merging]`

Never silently invent a translation key, CSS class, or helper function. If the codebase uses a translation function like `translate()` or `this.translateCallback()`, the skill must not fabricate keys — it must tag unverified keys so the developer catches them.

**Stricter sub-rule — unverified symbols cannot appear inside code the developer is meant to copy.** If a Fix's **code diff** contains an `[unverified: X]` symbol (e.g., `className="sr-only"` where `.sr-only` is not confirmed to exist in the repo), the Fix Confidence MUST be `Low` and a Design Decision block emitted. A developer copying an unverified class into a shared component risks shipping a visual regression. Either verify, or make the decision explicit.

## Rule 5 — No invented ARIA

Only attributes and roles listed in the WAI-ARIA spec (https://www.w3.org/TR/wai-aria-1.2/) may be proposed. If the skill is unsure whether an ARIA attribute exists or applies, it must NOT emit it. If in doubt, describe the intent in prose and tag the fix `Risk: High — verify attribute validity against WAI-ARIA spec`.

(A prior audit emitted `aria-valid` as a fix suggestion. That attribute does not exist. This class of error must never recur.)

## Rule 6 — No `aria-label` as a substitute for visible text

If sighted users would benefit from a label, propose visible text (with a visually-hidden backup for visually-hidden-but-SR-readable cases) over `aria-label`. `aria-label` replaces any child text content for AT — misusing it hides information from sighted users and from AT that prefers child text.

## Rule 7 — No predictive claims about automated tools or runtime behavior

The audit is static analysis. It has no information about what `axe-core`, Lighthouse, NVDA, VoiceOver, or any other tool will actually report when the code runs. Do NOT emit language like "axe will flag this", "NVDA will announce", "this will almost certainly trip rule X", or "Lighthouse will score this at Y". Predictive claims about tool output undermine the rest of the report the moment one of them is wrong.

**Acceptable forms:**

- "Affected WCAG criterion: 2.1.1 Keyboard" — citing the spec, not predicting tool output.
- "Manual keyboard walkthrough will confirm whether focus reaches this element" — naming a verification step, not predicting its result.

**Unacceptable forms:**

- "This will trip axe rule `button-name`." (Predicting tool output.)
- "NVDA will announce 'unlabeled button'." (Predicting AT behavior at runtime.)
- "Expected Lighthouse score: 75." (Predicting scoring.)

## Rule 8 — Semantic-element swaps in shared components must address visual regression

See `shared-component-rules.md` for full text and patterns. In short: when a Fix changes the rendered HTML element in a shared component library (e.g., `<span>` → `<button>`), the Fix MUST address the visual regression risk — either by referencing an existing unstyled-element utility, prescribing a scoped CSS reset, or escalating Risk to `High` with the reset concern stated plainly. A bare `<button>` replacing a `<span>` in a shared lib without these is a banned fix.

## Rule 9 — Fixes depending on an imported wrapper must analyze that wrapper

See `shared-component-rules.md` for full text. In short: if a Fix depends on how an imported component (`Icon`, `OverlayTrigger`, design-system primitive) wraps or forwards its children, the skill MUST open that component and summarize its behavior before emitting the Fix. If the wrapper cannot be opened (third-party black box), tag the Fix `Risk: High — wrapper behavior uninspected`.

## Rule 10 — No editing artifacts in the output

The report is a deliverable, not a transcript of the skill's thought process. Phrases like `Actually...`, `Re-graded:`, `Actually, re-graded:`, `On reflection,`, `Wait — that's wrong`, `Reconsidering,`, or any parenthetical like `(re-grading...)` / `(changed my mind)` MUST NOT appear anywhere in the report body. They are the skill's own analysis leaking out.

If the skill changes its mind about a severity, effort, risk, or fix approach while writing an issue, the ONLY acceptable recovery is to delete the incorrect content and rewrite the section cleanly. Do not leave the strike-through trail visible to the reader. A developer opening the report does not want to see two conflicting grades for the same issue — they need one answer.

**Before finalizing: search the draft for the strings above. If any are present, rewrite the affected section before emitting.**

## Rule 11 — Fixes cannot hand off semantic verification as a footnote

A Fix rated `Medium` or `High` confidence must be one where the developer can apply the code change and know why it's correct. If the Fix includes phrases like _"developer must verify the runtime side effects of X before merging"_, _"confirm the semantic meaning of this callback"_, or _"grep consumer products to check"_, then the Fix is not actually ready — the skill is handing the developer a verification task alongside a code change. In this case, either:

- **Do the verification as part of the audit** — read the callback, read the consumer code, confirm the semantic meaning, and remove the hand-off language from the Fix, OR
- **Drop Fix Confidence to Low** and convert the Fix to a Design Decision block that names the verification as the decision to be made.

Unverified symbols (Rule 4) are tagged and the developer confirms they exist. Unverified _semantics_ (what a callback does, whether DOM IDs are consumer-contracts, whether style classes propagate) are deeper — the developer can't "just verify" without an investigation the skill didn't do. Hand-off language masks that gap; this rule surfaces it.

---

## Self-check before emitting any Fix

Before writing any `Fix` field, the skill MUST internally answer these questions. If any answer is "no" or "not sure", the fix must either be bundled/expanded, have its Effort/Risk raised to `L` / `High`, or be escalated to `Needs design`:

1. Does this fix complete a pattern, or only part of one? (Rule 1, 3)
2. Does this fix create a focusable-but-inert element? (Rule 2)
3. Does this fix reference any symbol I have not verified? (Rule 4)
4. Is every ARIA attribute I'm emitting in the WAI-ARIA spec? (Rule 5)
5. Am I bundling everything that must ship together? (Rule 1, 3)
6. Would this fix hide information from sighted users? (Rule 6)
7. Am I making any predictive claim about runtime tool or AT output? (Rule 7)
8. If this fix swaps a semantic element in a shared component, have I addressed the visual-regression risk? (Rule 8)
9. If this fix depends on an imported wrapper's behavior, have I opened that wrapper and summarized what it does? (Rule 9)
10. Does my output contain any editing-artifact phrases (Actually, Re-graded, On reflection, etc.)? (Rule 10)
11. Am I handing off semantic verification inside a Medium/High confidence fix? (Rule 11)
