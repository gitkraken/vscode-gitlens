# Focus Flow — Tab Order, Modal Focus, Live Regions

**Why this file exists:** Focus management is the hardest part of flow-level accessibility. Individual components can be fully accessible and still produce a broken composition: modals that don't restore focus, tab orders that zig-zag, live regions that race. These bugs only surface when components are composed into a view, which is why the flow audit is responsible for them.

The rules below are the load-bearing discipline. `safety-rules.md` has the compressed statements; this file has the "why, how, and what to recommend" detail.

---

## Tab order rules

### Rule: Tab order matches visual reading order

For a left-to-right language, the Tab sequence should move top-to-bottom, left-to-right, following the visual reading order a sighted user would expect.

When they disagree, the cause is almost always one of:

1. **CSS reordering** — `flex-direction: row-reverse`, `order: N`, `grid-template-areas` that place items visually out of DOM order.
2. **Portals / teleports** — React `createPortal`, Vue `<Teleport>`, Svelte portals render content in a different DOM location than where the component is written. The DOM location determines Tab order; the visual location is where the user expects.
3. **`position: fixed` / `position: absolute`** without DOM-order alignment — a visually-prominent floating element appears late in Tab sequence because it's late in the DOM.
4. **`tabindex` with positive values** — overrides the natural order globally and almost always produces something unpredictable.

### Why `tabindex > 0` is banned

A positive `tabindex` reorders the focus sequence globally. `tabindex="1"` jumps to the front regardless of DOM position. Multiple positive values create an explicit order: 1, 2, 3, ... , then everything else. Any developer adding a new focusable element later has to pick its position in the numbered sequence — and in practice, they forget, or guess, or pick a number that conflicts.

**The correct fix for focus-order bugs is to fix the DOM**, not to paint over with `tabindex`. Reorder the JSX / template; remove the CSS reverse; move the portal content to a more sensible DOM location.

### Valid uses of `tabindex`

- `tabindex="0"` — add an element to the natural Tab order. Appropriate for custom interactive controls built from `<div>` / `<span>`.
- `tabindex="-1"` — remove an element from Tab order but keep it focusable programmatically. Appropriate for skip-link targets (`<main tabindex="-1">`), programmatically-managed focus targets, and elements you want to focus via `.focus()` without them being in the natural sequence.

Neither of these reorders Tab; they just add/remove elements.

### Detecting Tab-order bugs

Flow audits cannot fully verify runtime Tab order from static analysis, but they can detect the likely-causes:

- Grep for `tabindex=` and filter for positive values — any `tabindex="1"` / `tabindex="2"` is almost always a bug.
- Grep for `flex-direction.*reverse`, `grid-template-areas`, `order:` — these are high-signal CSS patterns for visual-vs-DOM mismatch.
- Find portals (`createPortal`, `<Teleport>`, Svelte portal syntax) — check where the portaled content renders vs where it appears visually.

Flag uncertain cases as "Items Requiring Runtime Tooling to Confirm" — a keyboard pass in a browser is the authoritative check.

---

## Modal and dialog focus patterns

A dialog/modal is the single most common source of focus-management bugs at the flow level. Four rules; all four are required for a complete fix. A partial fix is a banned fix (Rule 4 of safety-rules.md).

### 1. Focus moves INTO the dialog on open

When the dialog opens, focus must move to a sensible element inside the dialog. Options, in order of preference:

- **First focusable control** — often the dialog's primary input or action. For a confirmation dialog, the "Cancel" button is often the safe default (so Enter doesn't auto-confirm).
- **First form field** — for dialogs that are forms, focus the first input.
- **Close button** — acceptable for informational dialogs (the user needs to read content, then close).
- **Dialog container with `tabindex="-1"`** — last resort. Focus the dialog element itself, so the screen reader announces the dialog's accessible name, then the user Tabs to the first interactive element.

Never leave focus on the trigger button or somewhere outside the dialog — the user opens a dialog expecting their context to move into it.

### 2. Focus is trapped inside the dialog while open

Tab from the last focusable element in the dialog wraps to the first. Shift+Tab from the first wraps to the last. Focus never escapes to the page behind the dialog while the dialog is open.

**Implementation:** a focus-trap library (`focus-trap`, `react-focus-lock`, `@radix-ui/react-dialog`, `<dialog>` element with `showModal()` — the native browser dialog DOES implement the trap correctly) or a manual implementation with careful Tab/Shift+Tab handling.

**Why it matters:** without the trap, the user's next Tab exits the dialog and goes to the page below. The page is often obscured; the user has no idea where focus went.

### 3. Escape closes the dialog

`keydown` on Escape closes the dialog. This is both a user-comfort and a WCAG-expected behavior — no keyboard trap (2.1.2) requires an escape mechanism for every keyboard-accessible widget.

### 4. Focus restores to the triggering element on close

When the dialog closes, focus returns to the element that opened it (the button/link the user pressed). The user's mental map of the page is preserved — they picked up where they left off.

**Implementation:** save a reference to `document.activeElement` (or an explicit trigger ref) at dialog-open time; call `.focus()` on that reference at dialog-close time.

**Fallback when the trigger no longer exists** — e.g., dialog was opened from a toast that has since auto-dismissed. Fall back to:

- A sensible parent element (the list or region that contained the trigger).
- `<main>` with `tabindex="-1"` as the last resort.

Never let focus fall to `<body>` — the user is dumped at the top of the page with no context.

### Return-target specificity

The restored focus target must be specific. Acceptable:

- The exact trigger element (`<button>` that opened the dialog).
- The parent container if the trigger was a list item that got deleted by the dialog's action.
- `<main>` with `tabindex="-1"` for the fallback case.

Unacceptable:

- `document.body` or the document itself.
- An arbitrary first focusable element on the page.
- The first dialog trigger found (if there are many).

---

## `autoFocus` — when it's appropriate, when it's banned

`autoFocus` (React prop, `autofocus` HTML attribute) sets focus on an element when it mounts. It's useful in some contexts and harmful in others.

### Appropriate uses

- **Single-field search interstitial** — a search overlay that opens in response to a user action (Cmd+K, etc.) should autofocus its input. The user's intent is unambiguous; they want to type immediately.
- **Dialog primary input** — if the dialog's job is to capture a value (rename, new-item creation), autofocus the input. This is often equivalent to "focus moves INTO the dialog on open, targeting the primary input."
- **Step-by-step wizards** — when a new step mounts, autofocus the first field.

### Banned uses

- **Page-load autofocus** — never autofocus a form field on initial page load. The user hasn't interacted yet; stealing focus disorients screen-reader users (the announcement starts mid-page) and keyboard users (they expected focus at the top).
- **Every form** — autofocusing the first field of every form in a view is a banned pattern. A form that's "just there" on the page shouldn't capture focus; the user may be reading surrounding content.
- **A widget inside a large view** — if autofocus triggers in the middle of a multi-region page, the user's scroll position jumps. Respect the user's starting location.

When in doubt, don't autofocus. Let the user decide where to begin.

---

## Focus restoration after navigation / view transition

When a route changes (SPA navigation), browser default focus handling typically does NOT move focus to the new view. Focus remains on the link that was clicked, which is now on a DOM that was replaced. This is a 2.4.3 Focus Order bug.

### Canonical pattern

On route change:

1. Move focus to the new view's `<h1>` (or `<main tabindex="-1">` if no `<h1>` yet).
2. Screen readers announce the new page title.
3. Keyboard users start from a sensible anchor.

### Implementation notes

- React Router: `useEffect` on route change, `ref.current?.focus()` on the `<h1>` or `<main>`.
- Vue Router: similar via `watch` on route.
- Svelte / SvelteKit: has a built-in focus management option (`invalidate` / `afterNavigate`).
- Frameworks that opt out of managing focus require the app to handle it.

### What to flag

If the view's route change doesn't visibly handle focus anywhere:

- Check whether the app has a global focus-on-route-change hook.
- If not, flag as a flow-level gap. The fix is at the routing layer, not the view.

---

## Live region rules

### Single owner per announcement type

A view should have:

- **At most ONE `aria-live="polite"` region** — the "polite channel" for non-urgent updates (save confirmations, field validation messages, toast notifications).
- **At most ONE `aria-live="assertive"` region** (sometimes called `role="alert"`) — the "urgent channel" for errors or time-sensitive warnings. Use sparingly; assertive interrupts the user's current AT speech.

Multiple polite regions on the same view compete: when two fire near-simultaneously, AT reads one and drops the other (implementation-dependent). Multiple assertive regions stack interruptions and are disorienting.

### Centralized vs distributed live regions

Two common architectures:

- **Centralized** — one view-level live region (often in the app shell), components dispatch announcements to a central store, the live region renders them in order. This is the safer default for complex views.
- **Distributed** — each component has its own live region, but only ONE component owns announcements at a time. Enforceable only with tight coordination; fragile.

The centralized pattern is recommended for any view with more than one component that needs to announce state.

### Live region attributes

- `aria-live="polite"` — announce when AT is idle.
- `aria-live="assertive"` — announce immediately, interrupting current speech.
- `aria-atomic="true"` — announce the entire region's content, not just the changed portion. Useful when the region's meaning depends on multiple elements.
- `aria-relevant="additions text"` — control which mutations trigger announcements (defaults are usually correct; override only when you understand the spec).
- `role="status"` — implicit `aria-live="polite"` + `aria-atomic="true"`.
- `role="alert"` — implicit `aria-live="assertive"` + `aria-atomic="true"`.

Prefer `role="status"` / `role="alert"` over raw `aria-live` — they express intent and come with sensible atomic defaults.

### Detecting live-region conflicts

Grep the view for:

- `aria-live=` — list all live regions.
- `role="status"` — implicit polite.
- `role="alert"` — implicit assertive.

For each, identify its owner (which component renders it) and what it announces. If two components own polite regions and both announce in the same user interaction, that's a race.

### Live-region anti-patterns

- **Conditional mount** — a live region that's `display: none` until there's a message, then mounts and immediately announces. AT may not pick up the announcement if the region was just inserted. The region should be present in the DOM at all times; only its CONTENT should change.
- **`aria-live` on non-visible content** — ironically, AT still announces it. If the region is not visible AND not intended for AT, it shouldn't have `aria-live`. If it IS intended for AT but visually hidden, use a `.sr-only` class, not `display: none`.
- **Announcing everything** — `aria-live` on a chat log or a rapidly-updating data table creates a firehose. Use `aria-live` only for user-facing state changes (success, error, loading); use `role="log"` for ongoing-stream use cases.

---

## Shadow DOM focus boundaries

Web components (Lit, Stencil, vanilla custom elements) encapsulate internals inside a shadow root. Focus crosses shadow boundaries during Tab traversal, but the behavior is counter-intuitive and invisible in static grep.

### How shadow boundaries affect Tab

- Tab traversal enters a shadow root automatically — every focusable element inside the shadow tree participates in the document's Tab sequence, in shadow-DOM-tree order.
- `document.activeElement` points to the shadow HOST, not the focused element inside. Use `element.shadowRoot.activeElement` (recursively) to reach the inner focused element.
- `.focus()` called on the shadow host from outside focuses the host itself (no-op if the host is not focusable) UNLESS the host declares `delegatesFocus: true` — then the call is delegated to the first focusable inside.

### `delegatesFocus: true` behavior

Declared on the shadow root: `this.attachShadow({ mode: 'open', delegatesFocus: true })`. Effects:

- `host.focus()` delegates to the first focusable inside the shadow tree.
- Click/tap on the host (or any non-focusable descendant) moves focus to the first focusable inside.
- `:focus` on the host matches when ANY descendant in the shadow tree has focus — useful for styling focused compound controls.
- `:focus-visible` is per-element, so the host's `:focus-visible` state does NOT propagate the same way. Styles relying on `:focus-visible` on the host when a shadow-internal element is focused will not match.

### Auditing focus across nested shadow roots

- Walk the composed tree component-by-component. For each custom element, note whether it uses a shadow root and whether `delegatesFocus` is set.
- Tab-order enumeration is per shadow tree: a component with three focusable internal elements contributes three Tab stops in its internal order, inserted at the host's position in the outer Tab sequence.
- `<slot>` content (light-DOM children projected into a shadow slot) is focused in its LIGHT-DOM tree position, not the slot's position — even though it appears visually inside the shadow tree. This is a common source of Tab-order confusion.

### Shadow-DOM focus anti-patterns

- **Focusing a shadow-internal element from outside without delegation** — e.g., a parent calls `someCustomElement.shadowRoot.querySelector('button').focus()`. Works, but is tightly coupled to the child's internals; any restructure inside the child breaks the parent. Prefer `delegatesFocus: true` + `host.focus()`.
- **Tab skipping the host** — if the host has no focusable internals AND is not itself focusable (no `tabindex`, not an `<a>`/`<button>`/form control), Tab passes through it entirely. A host meant to receive focus (e.g., a dialog shell) needs `tabindex="-1"` or a focusable internal.
- **Focus trap implemented in light DOM, child components in shadow DOM** — the trap's "first/last focusable" query must cross shadow boundaries; `querySelectorAll('[tabindex], button, ...')` from the trap's root will NOT find elements inside shadow trees. Use a focus-trap library that explicitly supports shadow DOM (or walk the tree manually).
- **`.focus()` on the host when delegation is absent** — silently no-ops. The dev sees nothing; the AT user notices focus didn't move. Always verify `delegatesFocus` OR focus an internal element explicitly.

---

## When focus management is ambiguous

Some compositions genuinely require a Design Decision:

- **Multiple modals at once** — a modal opens, user triggers another modal from within it. Where does focus restore when the inner modal closes? Back to the outer modal? Or all the way to the original trigger? (Usually: back to the outer modal's trigger.)
- **Dialog that dismisses its own trigger** — a "delete item" dialog whose trigger is the item itself. After delete, the trigger is gone. Where should focus go? (Usually: the previous/next item in the list, or the list container.)
- **Toast that the user wants to interact with** — toasts usually don't steal focus (otherwise they interrupt), but users may want to click a toast's action. If the user Tabs, does focus go to the toast? (Usually: no, unless `role="alertdialog"` or similar.)

In all these cases, the fix is a Design Decision block, not a Medium-confidence code change. Escalate.
