# ARIA Patterns — Completeness Table and Authoring Notes

**Why this file exists:** Composite ARIA patterns are the single most common source of "bad ARIA" bugs. A partial pattern — `role="grid"` without `role="row"` children, `role="menu"` without keyboard support — is worse than no ARIA at all because screen readers announce the broken structure literally.

This file serves two audiences simultaneously:

- **The auditing agent** uses it to enforce Rule 1 (pattern completeness) and Rule 3 (container role without children).
- **The developer reading the audit** uses the plain-language blurbs and APG links to understand patterns they haven't implemented before.

---

## Pattern completeness table

| Pattern            | Required (all, in the same PR)                                                                                                                                                                 | APG                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Grid**           | `role="grid"` + `role="row"` + `role="gridcell"` (+ optional `columnheader` / `rowheader`, `aria-rowcount`, `aria-colcount`, keyboard: arrow keys between rows/cells, Home/End, Ctrl+Home/End) | https://www.w3.org/WAI/ARIA/apg/patterns/grid/         |
| **Menu / menubar** | `role="menu"` (or `menubar`) + `role="menuitem"` + keyboard (arrow keys, Home/End, Escape, Enter/Space, optional type-ahead)                                                                   | https://www.w3.org/WAI/ARIA/apg/patterns/menubar/      |
| **Listbox**        | `role="listbox"` + `role="option"` + `aria-activedescendant` OR roving tabindex, keyboard (arrows, Home/End, Enter/Space)                                                                      | https://www.w3.org/WAI/ARIA/apg/patterns/listbox/      |
| **Tree**           | `role="tree"` + `role="treeitem"` + `aria-expanded` (on parents) + arrow-key navigation (Right/Left expand/collapse, Up/Down move)                                                             | https://www.w3.org/WAI/ARIA/apg/patterns/treeview/     |
| **Tabs**           | `role="tablist"` + `role="tab"` + `role="tabpanel"` + `aria-controls` + `aria-selected` + arrow-key navigation between tabs                                                                    | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/         |
| **Radio group**    | `role="radiogroup"` + `role="radio"` + `aria-checked` + arrow-key navigation + single tab-stop (roving tabindex)                                                                               | https://www.w3.org/WAI/ARIA/apg/patterns/radio/        |
| **Combobox**       | `role="combobox"` + `aria-expanded` + `aria-controls` + `role="listbox"` popup + `aria-activedescendant` + Escape to close                                                                     | https://www.w3.org/WAI/ARIA/apg/patterns/combobox/     |
| **Dialog**         | `role="dialog"` (or `alertdialog`) + accessible name (`aria-labelledby` / `aria-label`) + focus trap + Escape to dismiss + focus restore on close                                              | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ |
| **Disclosure**     | `aria-expanded` on a button, controlling a region (no role required on the region itself)                                                                                                      | https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/   |

If the issue can only be fixed by adopting the full pattern, the `Fix` must describe the full pattern (even briefly) and the issue MUST be `Effort: L` with `Risk: High`, or escalated to `Needs design`. **Do NOT propose a single role from the table as a standalone fix.**

---

## Plain-language blurbs (for the human reading the audit)

These are the sentences a developer who has never implemented the pattern needs to understand what they're being asked to build. Include them in the Fix or Design Decision block when the pattern is referenced.

### Grid

A grid lets screen-reader users navigate two-dimensional data by row and cell (like a spreadsheet). Arrow keys move one cell at a time; screen readers announce "row 3, column 2, cell content" as the user moves. Mis-implementing a grid (missing rows or cells) causes screen readers to announce "empty grid" or flatten the structure, which is worse than no grid role at all.

### Menu / menubar

A menu is a list of actions that opens from a button or menubar (File → Open, for example). Menus have their own keyboard model: arrow keys move between items, Escape closes, Enter activates. Applying `role="menu"` to a `<ul>` without the keyboard model makes screen readers announce "menu with 5 items" that the user then cannot operate.

### Listbox

A listbox is a single-select or multi-select list (like a native `<select>`, but custom-styled). Unlike a menu, selection persists and can be reported back. Requires `aria-activedescendant` (a focus-like pointer to one option) or roving tabindex (physical focus moves between options). The wrong choice between these two techniques can leave the listbox navigable by mouse but not keyboard.

### Tree

A tree is a hierarchical list with expand/collapse (file explorer, etc.). Users expect Right arrow to expand a collapsed node, Left arrow to collapse an expanded one; Down/Up to move linearly through visible items. `aria-expanded` announces the expand state.

### Tabs

Tabs are a set of selectable section-switchers. `aria-selected` announces which tab is active; `aria-controls` links the tab to its panel. Arrow keys move between tabs; Tab (keyboard) moves into the active panel's content.

### Radio group

A radio group is a set of mutually-exclusive choices. Arrow keys move between radios AND activate them (changing selection as you move); the whole group is a single tab-stop. Implementing a radio group without the arrow-key behavior turns each radio into its own tab-stop, making the group painful to navigate.

### Combobox

A combobox is a single-line input that opens a listbox of suggestions (autocomplete, search with dropdown). The most error-prone pattern in ARIA — three standard variants, each with different keyboard behavior. If you're not sure which variant you're implementing, the fix MUST be `Fix Confidence: Low` with a Design Decision block.

### Dialog

A dialog is a modal overlay that requires a user response. Focus MUST move into the dialog when it opens, MUST be trapped inside until it closes, and MUST return to the triggering element on close. Escape must close it. `alertdialog` is a variant for urgent messages; the focus-trap and Escape requirements are the same.

### Disclosure

A disclosure is the simplest interactive pattern: a button that shows/hides a region. No role required on the region — just `aria-expanded` on the button and a predictable visual state.

---

## Common mistakes to refuse

- **`role="menu"` on a UI that's actually a select** — use `listbox` instead. Menus are for actions; listboxes are for selection.
- **`role="dialog"` on a non-modal popover** — a popover (a hint that appears on focus or click) is NOT a dialog. Use `role="tooltip"` for hint content, or no role for arbitrary content.
- **`role="tablist"` without `role="tabpanel"`** — tablists without panels are just styled button groups. Use a button group if that's what it is.
- **`aria-selected` on items that are not in a selection widget** — `aria-selected` is only valid on `role="option"`, `tab`, `gridcell`, `row`, `columnheader`, `rowheader`, `treeitem`.
- **Manual `aria-activedescendant` without keyboard handlers** — the attribute tells AT "this is focused-ish"; it does nothing on its own. Always paired with keyboard movement that updates the attribute.
