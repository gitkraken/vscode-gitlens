# Framework-Specific Audit Notes

Load this reference when the detection spine identifies the framework. Scan the relevant section for anti-patterns and idioms before writing fixes. This file is intentionally not exhaustive — it captures the high-frequency, easy-to-miss issues per framework.

---

## React

### Common anti-patterns

- **`<span onClick>` / `<div onClick>`** — pervasive in React codebases. Convert to `<button>` per Rule 8 safety guidance. Remember: the handler for `<button>` should be `onClick`, not `onMouseDown` — keyboard activation (Enter/Space) fires `click`, not `mousedown`.

- **`React.cloneElement` wrappers** — used by `OverlayTrigger`, tooltip libraries, DnD libraries. When a Fix depends on one of these wrappers (Rule 9), the key questions are:
  - Does `cloneElement` forward all props, or only known ones? (`aria-*` attributes sometimes get dropped by typed wrappers.)
  - Does the wrapper add its own `onClick` / `onKeyDown`?
  - Does the wrapper add `tabIndex` to its child?

- **`data-*` attributes vs semantic attributes** — VS Code webviews often use `data-vscode-context` on elements to hook context menus. Converting `<span data-vscode-context>` → `<button data-vscode-context>` preserves the VS Code integration. Do NOT strip `data-*` attributes in a semantic swap.

- **Controlled vs uncontrolled state on ARIA attributes** — `aria-pressed`, `aria-expanded`, `aria-checked` must reflect actual state at all times. A `<button aria-pressed={isActive}>` that lags the CSS class is worse than no `aria-pressed` at all. Verify the state source is reliable.

- **`onKeyDown` with `stopPropagation()`** — a common mistake. Unconditional `stopPropagation()` inside a form or modal can prevent Tab/Escape from bubbling to parent handlers. Only stop propagation on the specific keys being consumed (Enter, Escape, arrow keys as applicable).

### React-bootstrap specifics

- `OverlayTrigger` with `trigger={['hover', 'focus']}` — the `focus` trigger only works if the wrapped child is focusable. A `<div>` with no `tabIndex` will never fire focus, so the tooltip is mouse-only despite appearances.
- `Tooltip`'s accessible name doesn't automatically become the wrapped element's accessible name. Add `aria-label` on the interactive element directly.

### react-virtualized / react-window specifics

- Virtualized lists render rows lazily. Screen-reader users get `aria-rowcount` / `aria-setsize` to know the total, but only rendered rows are in the DOM. Test that the virtualizer sets these attributes; if it doesn't, audit accordingly.

### Typing check

- If a Fix references a prop on a typed component (e.g., `<Filter aria-pressed={settings?.isFilterActive}>`), verify the prop exists on the component's type. Per Rule 4, an unverified prop in a code diff forces `Fix Confidence: Low`.

---

## Lit (web components)

### Common anti-patterns

- **`connectedCallback` setting `role`** — if the component sets its own role in `connectedCallback`, consumers cannot override it. Flag as API issue.

- **Shadow DOM accessible-name inheritance** — `aria-labelledby` and `aria-describedby` DO NOT cross shadow DOM boundaries in older spec. With the accessibility tree improvements in recent browsers, this is partially fixed — verify with DevTools Accessibility panel rather than assuming.

- **Slotted content + internal roles** — if a component has `<slot>` for children AND sets `role="listbox"` on its internal container, the consumer's `<option>` elements slotted in still participate. Don't re-wrap slotted content in another element that loses their roles.

- **Form association** — for form-like web components (inputs, selects), implement ElementInternals or ensure the component actually participates in form submission. ARIA alone without form participation won't satisfy form accessibility.

### Styling boundary for Lit

- **Internal styles (`:host`)**: the component owns its a11y — focus outline, hover states, state indicators.
- **`::part(X)`**: exposed parts consumers can style. Focus outline on parts is the consumer's responsibility AND the component's responsibility — provide a default.
- **`::slotted(...)`**: consumer content. Don't silently restyle slotted content's focus or interactivity.

### Common Lit idioms to recognize

- `@property()` / `@state()` decorators — tracked state that updates rendering.
- `willUpdate` / `updated` lifecycle — where ARIA attributes should be synced with state.
- `LitElement` with no explicit `role` — fine if the component is non-interactive and composes children; flag if it's interactive.

---

## Svelte

### Common anti-patterns

- **`on:click` on non-interactive elements** — same as React's `onClick` issue. Svelte has `on:keydown` for the keyboard handler. Svelte 5+ will emit a11y warnings in dev for this pattern; check if the project has them disabled.

- **`{#each}` without stable keys** — causes DOM reordering that can confuse screen-reader position tracking. Not always a bug, but worth flagging when the list is a focus-tracked widget.

- **Transitions on focused elements** — Svelte's `transition:` directives can delay focus movement or mount timing. Verify that focused elements don't animate IN via a transition that breaks focus.

### Svelte-specific idioms

- `use:action` for custom behaviors — the a11y semantics of these are the action author's responsibility. If a fix depends on a `use:` action (e.g., `use:portal` or `use:focus-trap`), read the action's implementation per Rule 9.

- `bind:this` + `.focus()` in `onMount` — common autofocus pattern. Ensure the autofocus is appropriate (not every component should autofocus; autofocus on page load is often wrong).

---

## Vue

### Common anti-patterns

- **`@click` on non-interactive elements** — same as React/Svelte. Vue 3 has a11y ESLint plugins; check if the project uses them.

- **`v-if` vs `v-show` for modal contents** — `v-show` keeps the element in the DOM but hidden via `display: none`. Screen readers generally respect that. `v-if` removes the element, which is cleaner for dynamic content. Choose based on whether focus needs to be preserved between hides.

- **Slots with no `name` attribute** — when analyzing composition, slotted content is the consumer's. Don't assume its a11y without knowing what's slotted.

### Vuetify / Element Plus specifics

- Most a11y is delegated to the library. Audits should check the library version for known a11y issues rather than auditing the library's internals.

---

## Vanilla HTML / JS

### Common anti-patterns

- **`<a href="#">` with `onclick`** — should be `<button>`. Links go somewhere; buttons do things.
- **`<div contenteditable>`** without explicit `role="textbox"` and `aria-multiline`.
- **`onclick="..."` inline** — same semantic issue as framework cases.
- **Custom controls built with `<div>` + JavaScript** — needs full ARIA pattern per `aria-patterns.md`.

### Legacy-content audits

For HTML content that predates modern frameworks, check:

- `alt` on every `<img>` (empty `alt=""` for decorative is correct)
- `<table>` with `<thead>` / `<th>` for tabular data
- Form fields associated with `<label for="id">`
- Heading hierarchy not skipped
- `tabindex` values — positive values are an anti-pattern

---

## Framework-agnostic: VS Code extension specifics

(Applies regardless of what framework renders the webview contents.)

- **Webview panels are fully your responsibility for a11y.** VS Code doesn't inject semantics into the webview DOM — audit thoroughly.
- **Tree views** using `TreeDataProvider` inherit VS Code's a11y. Focus on `TreeItem.label` and `description` being meaningful.
- **Quick picks / input boxes** use VS Code's built-in a11y. Check that label / description / placeholder text you provide are descriptive.
- **Status bar items** — check `accessibilityInformation` is meaningful.
- **Commands** — command titles appear in the command palette. Make them descriptive.
- **Decorations** — file/line decorations rendered by your extension should not convey information through color alone.
- **VS Code's own `--vscode-*` CSS variables handle theme integration.** Don't hardcode colors that break in high-contrast mode.
