# Webview Keyboard Navigation & Focus Patterns

Reusable patterns for keyboard navigation and focus management in complex Lit webviews. This is the
_how_; `accessibility.md` is the _requirements_ checklist. The primary worked example throughout is the
commit graph (`src/webviews/apps/plus/graph/`) — a virtualized `role="tree"` with rich per-row controls —
but the patterns apply to any dense, interactive webview surface.

> Rule of thumb: a keyboard user must be able to reach every control a mouse can, the focus indicator must
> always be visible on the element that actually holds focus, and an action that moves the user elsewhere
> must move focus with it.

## 1. Roving tabindex groups (one tab stop for N controls)

A toolbar/list of N focusable controls should be **one** tab stop, not N. One control holds `tabindex="0"`,
the rest are `tabindex="-1"`, and Arrow keys move the `0` between them. Tab enters/leaves the group as a
unit; Home/End jump to the ends.

Reuse the shared implementations — do **not** hand-roll:

- **`RovingTabindexController`** (`src/webviews/apps/shared/controllers/roving-tabindex.ts`) — vertical or
  complex groups, managed imperatively, keyed by `data-roving-key` (survives re-renders/reorders),
  orientation-aware, skips disabled, tracks a default item until the user actually arrows. Used by the graph
  header, the sidebar icon rail, and the overview cards.
- **`action-nav`** (`src/webviews/apps/shared/components/actions/action-nav.ts`) — horizontal, slot-based;
  skip-disabled (init + on rove), Home/End, reach-through non-delegating wrappers (e.g. `gl-tooltip`), a
  `MutationObserver` to re-home off a control that disables. Used by the search box's option clusters and
  panel headers.

Guard modified arrows: a roving handler should early-return on Alt/Ctrl/Meta/Shift so chords (e.g.
Shift+Arrow to resize/reorder a column) reach the control's own handler instead of being swallowed by roving.

## 2. Virtualized tree = single tab stop + an intra-row "dive"

`gl-lit-graph` is a `role="tree"` with `aria-activedescendant`: **one** tab stop, Up/Down move the active
row _virtually_ (no per-row tab stop). Patterns that make this navigable:

- **Header-first ordering.** The tree role/`tabindex="0"`/`aria-activedescendant` live on an inner
  `.gl-graph__tree` wrapping the virtualizer, with the column header as a preceding sibling — so tabbing in
  lands on the header first, then the tree, with no DOM reshuffling.
- **Dive into the active row.** Tab from the tree moves focus into the active row's controls, organized as
  roving groups in visual order: **refs (pills) → actions (buttons)** (`rowGroupControls`,
  `enterActiveRowGroup`). All row controls are `tabindex="-1"` (managed); Left/Right rove within a group,
  Tab crosses to the next group then leaves the graph, Shift+Tab/Esc retreat to the tree.
- **The phantom scroll-container stop.** When every interactive child of a scroll container is
  `tabindex="-1"`, Chromium adds the _scroller itself_ to the tab order (keyboard-focusable scroll
  containers) — a spurious stop where Up/Down natively scroll instead of navigating. Fix: put
  `tabindex="-1"` on the scroller (`<lit-virtualizer>`); the real keyboard host is the tree wrapper.
- **Recycle corral.** Virtualized rows unmount when scrolled past the overhang, with no built-in focus
  restore. Track the managed focus element; if its row recycles out and focus falls to `<body>`, pull focus
  back to the tree (`recaptureFocusIfStranded`) — but only then, so it never steals a deliberate focus move.
- **Click must set up keyboard nav.** A row-body click has to land focus on the tree (not the click-focusable
  scroller) and re-pin the focus index to the clicked row, or the next Arrow key scrolls instead of navigates.

## 3. aria-activedescendant menus (keep real focus on the controller)

The grouped (multi-ref) pill is a menu button: focusing it opens a popover of refs. The cursor is virtual —
**DOM focus stays on the pill** and `aria-activedescendant` points at the active item. Never move real focus
into hoisted popover content: it destabilizes the popover's own focus tracking and the tree's focus model.

Split the visual state into two classes with two jobs:

- **`.is-active`** — the cursored **row** fills (container highlight). Colorization that de-conflicts text
  from the fill (e.g. ahead/behind stats switching to the contrast color) must key on `:is(:hover, .is-active)`,
  not `:hover` alone, or keyboard-cursored rows lose text into the fill.
- **`.is-cursor`** — the focus **rect** rides the specific cursored _item_ (the row, or a sub-action inside
  it). Splitting fill from rect lets Left/Right move the rect onto a sub-action (e.g. a jump button) while the
  row stays filled.

Navigation: Up/Down move rows (cursor resets to the row's first item); Left/Right rove the cursored row's
items (`groupedRowItems`: the ref, then its interactive sub-actions); Enter activates the cursored item;
Esc / Up-past-the-top exit. Give every activedescendant target a **stable `id`** (rows _and_ sub-actions).
See `handleGroupedPillKeydown` / `setRowItemCursor` / `clearGroupedPillCursor` in `gl-lit-graph.ts`.

## 4. Overlay-covered controls: keep filled, mirror the ring

A pill collapses to an icon and expands to an absolutely-positioned filled overlay
(`.gl-graph__ref-pill-expand`) on hover/focus. Its interactive sub-chips render **twice**: an in-flow copy
(the roving/focus target) and an `aria-hidden` expanded twin inside the overlay
(`refAdornmentProvider.ts`).

- Keep the fill on **`:focus-within`** so the pill stays "hover-styled" while a control inside it is focused
  (do **not** gate the fill on the pill's own `:focus` — that collapses it the moment focus dives into a
  sub-chip).
- The focused in-flow copy is now **covered** by the overlay. Mirror its focus ring onto the **visible
  expanded twin** with `:has()` (`.gl-graph__ref-pill:has(<chip>:focus-visible) .gl-graph__ref-pill-expand
<twin>`). Real focus + the accessible name stay on the in-flow copy; only the _visual_ ring rides the twin.
- Do the same for **tooltips**: a keyboard tooltip must re-anchor to the visible twin, not the covered copy
  (`expandedTwinIfCovered` in `gl-lit-graph.ts`), or it points at nothing behind the fill.

## 5. Focus rects as full-height bands, not inner boxes

For a segmented control, draw the focus rect as a full-height `::before` band that bleeds into the
container's vertical padding (`inset-block: -Xrem`) so it hugs the top/bottom edges — not a tight
`box-shadow` on the content box, which reads as a cramped inner box. Keep the horizontal gap **symmetric**:
if the container has padding on one side only, extend the band past the un-padded side (`inset-inline: 0
-0.5rem`) so the text sits centered in the rect. See the ref-pill upstream/jump, PR, and issue chips in
`graph.scss`.

## 6. Focus must follow navigation

An action that moves the selection or scrolls the view elsewhere must move **focus** to the destination too —
otherwise keyboard focus is stranded on the (now possibly off-screen) trigger, and the next Arrow key acts
from the wrong place. `jumpToRefRow` focuses the tree at the jumped-to row and re-pins the focus index; as a
bonus, moving focus off the source pill collapses its fill and closes its popover ("unfocus the old stuff").

## 7. Tooltips on keyboard focus

Tooltips must appear on focus, not just hover (`accessibility.md`). Two gotchas:

- Delegated tooltips (a single host-owned tooltip resolving `data-tooltip` from the focused element) fire on
  a viewport `focusin` (`showTooltipForFocus`).
- An **aria-activedescendant cursor emits no `focusin`** — DOM focus never moves — so nothing triggers the
  tooltip. Surface it explicitly when the cursor moves (`setRowItemCursor` → `showTooltipForTarget`) and hide
  it when the cursor clears.

## 8. Decorations must clear the row focus ring

The row focus ring is an inset `::after` box-shadow ~1px from the row's edge (`.gl-graph__row.is-focused`):
inset (not flush) to match VS Code's `outline-offset: -1px` list rows _and_ to survive the virtualizer's
overflow clip on the flush-left edge. It's a top-most overlay because the row is a stacking context whose
positioned descendants would otherwise paint over a plain `outline`.

Consequence: a near-full-height decoration (the avatar/identity commit node) gets **clipped** by the ring
once it reaches the row edge — especially after a hover/select grow. Size such decorations so that, grow
included, they stay inside the ring's interior. The avatar node radius is capped for exactly this
(`nodeRadiusFor` / `avatarNodeRadius` in `graph-gutter.ts`): radius 9 (18px) so the ×1.1 grow (19.8px) clears
the ~20px interior of the 24px row.

## Key files

| Concern                                                                      | File                                                                                                                   |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Roving controllers                                                           | `src/webviews/apps/shared/controllers/roving-tabindex.ts`, `src/webviews/apps/shared/components/actions/action-nav.ts` |
| Tree / intra-row dive / activedescendant menu / focus-follows-nav / tooltips | `src/webviews/apps/plus/graph/graph-wrapper/gl-lit-graph.ts`                                                           |
| Pill markup + twin copies + activedescendant ids                             | `src/webviews/apps/plus/graph/graph-wrapper/adornments/refAdornmentProvider.ts`                                        |
| Node sizing vs. the ring                                                     | `src/webviews/apps/plus/graph/graph-wrapper/graph-gutter.ts`                                                           |
| Focus rings / bands / `.is-active` vs `.is-cursor`                           | `src/webviews/apps/plus/graph/graph.scss`                                                                              |

## See also

- `accessibility.md` — the requirements checklist (ARIA, focus traps, contrast, tooltip/Escape).
- `webview-styling.md` — design tokens, the `1rem = 10px` base, elevation, focus-ring colors
  (`--vscode-focusBorder`, `--vscode-list-focusOutline`).
