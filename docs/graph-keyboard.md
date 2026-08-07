# Commit Graph Keyboard Architecture

The Commit Graph's keyboard handling runs through a layered keymap registry: a chord/keybinding core in `packages/utils/src/keys/` (`chord.ts`, `keybinding.ts`), a dispatcher in `src/webviews/apps/shared/keymap/keymapDispatcher.ts`, and the graph's scopes/bindings registered from `graph-app.ts` and `gl-lit-graph.ts` (scope names in `src/webviews/apps/plus/graph/keymap/graphKeymap.ts`). The shortcut sheet (`gl-graph-keyboard-shortcuts.ts`) renders from the registry, so it cannot drift from the bindings.

## Resolution model

One `document` bubble-phase listener; it bails if a widget already called `preventDefault` — widgets keep first refusal. Then two axes, in order:

1. **Overlay stack (state axis, Esc only)** — a LIFO stack of open transient surfaces: hover card, ref-find, changes-mode menu, minimap zoom, column-drag abort, the details sheet stack's top sheet, the shortcut sheet. Esc pops the topmost willing entry. **Focus-independent** — a hovercard over a focused ref-find closes first. Surfaces push on open (`pushOverlay` → disposable) and dispose on any other close path. Widgets whose Esc must outrank the stack for focus-local transients (the search box's autocomplete/pause rungs) consume locally, but their _fallback_ action defers via `KeymapDispatcher.closeTopOverlay()` — the stack always outranks a dead-end fallback.
2. **Focus scope chain** — computed per keydown from `composedPath()`, innermost out:

| Scope           | Active when the event path contains…              | Scope guards                                                   |
| --------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `pillMenu`      | `.gl-graph__ref-pill`                             | —                                                              |
| `rowControl`    | a row control (ref pill, sub-chip, action button) | —                                                              |
| `rows`          | `.gl-graph__tree`                                 | rows loaded                                                    |
| `tree`          | `gl-tree-view` (any filterable tree)              | —                                                              |
| `sidebarFilter` | `.filter-input`                                   | —                                                              |
| `webview`       | always                                            | not a text entry; no **open** `<dialog>` in the path           |
| `webviewGlobal` | always                                            | no open `<dialog>` only — **deliberately no text-entry guard** |

A binding's `run()` may return `false` — the key falls to the next candidate, then to the platform default. Chord matching is exhaustive (all four modifiers always compared), `KeyA–Z`/`Digit0–9` tokens match `e.code` (layout-independent, numpad excluded), and `mod` resolves to Cmd on macOS / Ctrl elsewhere.

## The chord vocabulary

- **Plain keys** (`rows` scope): step/fold/jump — arrows, `j`/`k`, `Home`/`End`, `[`/`]`, `h`/`u`/`t`/`w`, `Enter`/`Space`, `i` (or `mod+I`, for the VS Code hover reflex) peek — the pointer's rich hover card on the focused row: toggles, follows the row cursor, on the overlay stack for Esc — `Ctrl+C` copy. Digits `1`–`0` (webview scope) select overview/WIP-bar worktrees.
- **Shift** = extend (selections, topologically along the first-parent chain) and variant jumps (`Shift+H`/`Shift+W`).
- **Ctrl/Cmd** = structural navigation: `Ctrl+↑↓` first-parent lineage (lane-faithful, steps through WIP rows), `Ctrl+←→` switch branch at a fork. `Ctrl+F` focuses the commit search box — or, with focus in a file tree (`tree` scope), that tree's filter box, opening it if hidden. Bare Ctrl (no chord) is also the lane-mode hold: holding it dims non-lane rows, unifying with `Ctrl+↑↓`/`Ctrl+←→` — see "Hold `Ctrl`" below.
- **Alt** = the chrome layer (`webviewGlobal` scope — works while typing in any graph text box): `Alt+M`/`S`/`D` toggle minimap/side bar/details, `Alt+Shift+D` docks details elsewhere, `Alt+1`–`8` toggle side bar panels, `Alt+K` Agent Kanban, `Alt+V` visualizations. Bare `Alt+↑↓` steps fork points (`Ctrl+Alt` accepted silently — GNOME grabs it at the OS).
- `/` opens the ref-find, `?` (or `mod+/`) the shortcut sheet.

### Why Alt for the chrome toggles

Toggles must work with the caret in a text entry (search box, filters, AI box) — the defining failure of the earlier Shift layer was `Shift+B` opening the sidebar _into_ its filter input and then being unable to close, because Shift+letter **is** typing. `Ctrl+letter` fails cross-platform (workbench reflexes like `Ctrl+B`; macOS readline bindings `Ctrl+A/E/B/D/F/K` in every text field). Alt+letter/digit types nothing on Windows/Linux; on macOS the bindings match `e.code` (immune to Option remapping) and `preventDefault` consumes the Option special character — a deliberate cost (`Option+S` = ß can't be typed in graph inputs while focused; avoid taking keys whose Option character is a _real letter_ — Kanban is `K` because `Option+A` is å).

Consequences that keep the layer coherent:

- Alt-carrying chrome-toggle bindings no longer touch the lane dim — Alt doesn't engage it, so there's nothing to suppress. Instead, Ctrl-carrying bindings whose action _isn't_ lane navigation (`Ctrl+F`, `Ctrl/Cmd+I`, `Ctrl/Cmd+C`, `?`/`mod+/`) call `suppressModifierChainUntilCtrlRelease()` first, and the bare Ctrl-hold lane dim has a ~500ms **engage delay** (`ctrlHoldEngageDelayMs`) — chording never flashes the dim; holding still highlights.
- Keyboard toggles **focus what they open** (rail-click parity — the sidebar toggle and `Alt+digit` land in the panel filter) and **return focus to the graph rows** when closing a surface that contains focus (`isFocusInside`, a shadow-root-walking containment check — plain `contains()` never crosses shadow boundaries).
- `Alt+digit` shadows VS Code's `openEditorAtIndex`; the webview's `preventDefault` suppresses it (verified live).

## Widget-internal keys (not in the registry)

| Keys                            | Where                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `F3` / `Shift+F3` (`Cmd+G` mac) | search box `window` listener  | works while typing; the same listener still serves `Ctrl+F`/F3 for other webviews — in the graph the registry preempts it                                                                                                                                                                                                                                                                                                                                                                  |
| `Enter`/`Shift+Enter`, `↑↓`     | search box / ref-find         | step matches / history; ref-find is on the overlay stack for Esc                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Esc ladder in the search box    | search box                    | autocomplete → pause → exit-to-rows; the exit rung defers to `closeTopOverlay()` first                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Space` / `Alt+Space`           | checkable `gl-tree-view` rows | toggle checkbox / mixed→unchecked. Tree type-ahead owns plain letters/digits but **not shifted letters** (freed for chords; matching is case-insensitive anyway)                                                                                                                                                                                                                                                                                                                           |
| Hold `Ctrl`                     | graph                         | lane highlight — dims off the focused/selected row's lane; stable under scrolling and mouse movement, the pointer never seeds or retargets it, only navigating/selecting a different commit moves it — falling back to HEAD when nothing is focused — keyup machinery, not a chord. Ctrl unifies "lane mode": `Ctrl+↑↓` walks the lineage, the hold lights the lane, the wheel still scrolls. Moved off Alt because Alt+wheel kills momentum scrolling at the OS level; Ctrl+wheel doesn't |

## Adding a binding

1. Pick the scope by _where the action makes sense from_ — `rows` for row-relative actions, `webview` for graph-wide actions that must yield to typing, `webviewGlobal` only for chrome toggles that must work mid-typing (and then the chord must be one that types nothing — see the Alt rationale above).
2. `sheet` metadata is **required** on every binding (`'hidden'` to opt out) — the shortcut sheet generates from it. Use `keysOverride`/`subline` with the display grammar (`raw:`/`mod:`/`text:`/`sep:` — see `SheetDisplayEntry` in `keybinding.ts`) for composed rails.
3. Alt-carrying chords: use code tokens (`alt+KeyX`), never bare letters — Option remaps `event.key` on macOS. Ctrl-carrying chords whose action isn't lane navigation: call `suppressModifierChainUntilCtrlRelease()` first, so the chord's own keydown never flashes the lane dim.
4. `run()` returns `false` when conditions aren't met, so the key falls through; never call `preventDefault` yourself — the dispatcher does, only on `true`.
5. Transient surfaces own no local Esc: push onto the overlay stack on open, dispose on every close path.
6. A navigation dead-end should announce (or load more rows) rather than consume the key silently.
