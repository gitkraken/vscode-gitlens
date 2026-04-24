# Verification Playbook — How to Test a11y Fixes

**Why this file exists:** Most developers fixing a11y issues do not own a screen reader and have not configured one. The audit must tell them what they CAN verify with tools they have (keyboard, browser DevTools, axe DevTools extension) and what they CAN'T verify without AT. Honest verification guidance is the difference between a PR the developer can confidently merge and one they ship on hope.

This file drives the "Verification Playbook" and "No-AT fallback" sections of the audit's Layer 1 Summary.

---

## Primary screen reader + browser pair — pick based on product type

| Product type             | Primary pair                            | Secondary pair                      |
| ------------------------ | --------------------------------------- | ----------------------------------- |
| VS Code webview          | NVDA + Edge on Windows                  | VoiceOver + latest VS Code on macOS |
| Electron desktop app     | NVDA + the app on Windows               | VoiceOver + the app on macOS        |
| Web app                  | NVDA + Firefox                          | VoiceOver + Safari                  |
| Shared component library | Test in both primary environments above |

**Name the pair explicitly. Do not write "use any screen reader."**

---

## Keyboard-only checklist (no mouse — anyone can run this)

- Every interactive element audited is reachable via `Tab` / `Shift+Tab`
- `Enter` and `Space` activate buttons and button-role elements
- `Escape` dismisses open popovers/dialogs and returns focus to the element that opened them
- Arrow keys navigate inside composite widgets (menus, grids, radio groups, trees, tabs — if present)
- No element is focused-but-inert (focus ring visible but no action possible)
- Focus is visible at every step (no elements where `:focus` / `:focus-visible` produces no change)

This is the baseline. Every developer should be able to run this checklist in five minutes, for any fix, without installing anything.

---

## Automated sanity check

- Install axe DevTools (browser extension) or run Lighthouse's a11y audit on the view that renders the components being fixed.
- Use it to spot issues static analysis cannot catch (duplicate IDs at runtime, missing form labels as rendered, focus-visible presence, contrast where it matters).
- **Do NOT treat a clean axe run as a compliance pass — axe is a tripwire, not a proof.**
- **Do NOT predict what axe or Lighthouse will report.** Per Rule 7, the audit has no runtime information. Run them, don't forecast them.

---

## No-AT fallback — what you CAN verify without a screen reader

**Most developers do not own NVDA or have VoiceOver set up.** Here's what they can confirm with keyboard + DevTools + visual inspection alone:

- Every `Safely Shippable Now` item whose failure is keyboard-focus-related (Tab reaches it, Enter/Space activates it, focus indicator visible).
- All decorative-element (`aria-hidden="true"`) changes — verify via DevTools Accessibility panel that the element is absent from the accessibility tree.
- All `<span onClick>` → `<button>` conversions — verify the button is Tab-reachable and activates with Enter/Space.
- All visible label changes — read the new label in the UI and confirm it matches intent.
- All `role` changes on static (non-composite) elements — use DevTools Accessibility panel to see the computed role.

---

## What REQUIRES a screen reader (cannot be verified without one)

- `aria-live` / `role="status"` announcements (you must hear them to confirm they fire)
- `aria-activedescendant` movement (the AT announcement is the only signal)
- Composite-pattern announcements (grid cell navigation, menu item selection, listbox option change)
- `aria-label` text that isn't visible in the UI (you can't read what AT will say without AT)
- `aria-describedby` association content

For issues in these categories, the dev cannot mark the fix "verified" without a screen reader.

---

## PR conventions for AT-pending items

If the developer cannot install a screen reader, they should flag AT-dependent items in their PR as:

> **Verified keyboard-only; AT verification pending.**
> I confirmed keyboard reachability, activation, and focus behavior. I could not verify screen-reader announcements for: `aria-live` region on line X, `aria-activedescendant` movement in the listbox. Requesting AT verification before merge.

This is honest and auditable. It does NOT count as "done." Reviewers or a designated AT-verifier must confirm the AT path before the PR merges.

---

## Per-P0 reproduction recipe template

For EACH P0 issue, the audit must write one "how to verify the fix works" recipe in 1–3 keyboard-only steps. These recipes are the developer's acceptance test — they must be keyboard-only where possible so the dev can actually run them.

### Template

> **Issue #[N]:** [One short step-by-step]
>
> 1. Open [view] in [target environment].
> 2. Press [keys] to reach [element].
> 3. Press [key] to activate [action].
>
> **Expected after fix:** [What the user should see or hear].

### Good example

> **Issue #2:** Verify the filter icon is keyboard-operable.
>
> 1. Open the graph view in GitLens.
> 2. Press Tab repeatedly until focus lands on the column-header filter icon (visual focus indicator appears on the icon).
> 3. Press Enter.
>
> **Expected after fix:** The column filter popover opens. Focus moves inside the popover to its first focusable element. Pressing Escape closes the popover and returns focus to the filter icon.

### Bad example — too vague

> Verify the filter icon works with keyboard.

(Not actionable. The dev must reconstruct steps themselves.)

---

## Items Requiring Runtime Tooling to Confirm

This section in the audit output lists items where static analysis cannot produce a yes/no — they are candidates for a follow-up runtime pass, NOT outstanding audit work and NOT hidden issue counts.

### Format for each item

> **[Concern, one phrase]** — To confirm: [what runtime check answers the question]. If confirmed as a problem, implication: [severity / scope].

### Examples

> **Focus indicator visibility on the new filter button** — To confirm: load the component in its host product, Tab to the button, observe whether `:focus-visible` produces a distinguishable outline. If not visible, implication: P1 (2.4.7 Focus Visible) — a design-level fix is needed.

> **Contrast ratio of `text-disabled` class against graph header background** — To confirm: run axe DevTools on a rendered graph with disabled header buttons, or use a contrast checker on the computed colors. If below 3:1, implication: P2 (1.4.11 Non-text Contrast) for interactive elements or P2 (1.4.3) if text.

### Framing

Always frame this section as "these are questions static analysis couldn't answer, not hidden issues the audit skipped." Reader must not over-weight this section as a set of probable additional bugs.
