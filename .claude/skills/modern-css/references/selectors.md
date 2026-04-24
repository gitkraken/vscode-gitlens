# Selectors & State

Selectors, state-based styling, pseudo-classes, and the shadow DOM styling API.

## Discipline rules

- `:has()` replaces many JS-based parent-context tricks. Reach for it first before adding JS for parent awareness.
- Never reach into shadow DOM from outside with descendant selectors. Use the exposed `::part`, `::slotted`, or custom property API.
- `:focus-visible` is what you almost always want for focus rings, not `:focus`.

## Features

### :has()

- **Baseline:** newly available (widely available mid-2026)
- **Purpose:** Parent/relational selection. Select an element based on what it contains or what follows it. Replaces many JS patterns for parent-aware styling.
- **Prefer over:** JS toggling parent classes based on child state, sibling-state libraries.
- **Syntax:**

  ```css
  /* Parent that contains an image */
  .card:has(img) {
  	grid-template-rows: auto 1fr;
  }

  /* Form with an invalid input */
  form:has(input:invalid) {
  	border-color: var(--color-error);
  }

  /* List item followed by another list item */
  li:has(+ li) {
  	border-block-end: 1px solid var(--border);
  }
  ```

### :is() / :where() / :not()

- _(Covered in `cascade.md`. See that leaf for specificity behavior, gotchas, and usage guidance.)_

### :focus-visible

- **Baseline:** widely available
- **Purpose:** Focus ring only when the user needs it (keyboard navigation), not on mouse click.
- **Prefer over:** `:focus` for focus ring styling. `:focus` fires on both keyboard and mouse; `:focus-visible` fires only when the UA determines the focus should be visible.
- **Migration strategy:** Do NOT bulk find-and-replace `:focus` → `:focus-visible`. Review per-instance: (a) `:focus` on `<input>`, `<textarea>`, `<select>` is correct — keep it, these always show focus. (b) `:focus` on buttons, links, custom interactive elements — migrate to `:focus-visible`. (c) `:focus` used for state indication beyond the ring (background, border changes on click) — needs design review before changing. Test keyboard navigation after each migration.
- **Syntax:**
  ```css
  button:focus-visible {
  	outline: 2px solid currentColor;
  	outline-offset: 2px;
  }
  ```

### :focus-within

- **Baseline:** widely available
- **Purpose:** Style a parent when any descendant receives focus. Useful for form groups, dropdown containers, and input wrappers.
- **Prefer over:** JS focus-bubbling event handlers to toggle parent classes.
- **Syntax:**
  ```css
  .search-bar:focus-within {
  	box-shadow: 0 0 0 2px var(--accent);
  }
  ```

### :host

- **Baseline:** widely available
- **Purpose:** Style the shadow root's host element from inside its shadow DOM. Defines the component's own default styles.
- **Syntax:**
  ```css
  :host {
  	display: block;
  	contain: content;
  }
  ```

### :host()

- **Baseline:** widely available
- **Purpose:** Style the host when it matches a selector. Enables conditional component styling based on host attributes or classes.
- **Syntax:**
  ```css
  :host(.compact) {
  	padding: 0.25rem;
  }
  :host([disabled]) {
  	opacity: 0.5;
  	pointer-events: none;
  }
  ```

### :host-context()

- **Baseline:** limited — Chromium only. Firefox never implemented; Safari support partial. **Deprecated** — CSS WG resolved to drop from spec.
- **Purpose:** Style the host when an ancestor matches a selector.
- **Warning:** Do not use in cross-browser code. Firefox does not and will not support this. Use custom properties or explicit host attributes instead.
- **Syntax (Chromium only):**

  ```css
  /* Deprecated — avoid in cross-browser code */
  :host-context([data-theme='dark']) {
  	--component-bg: #1a1a1a;
  }

  /* Preferred alternative: custom properties piercing shadow DOM */
  :host {
  	background: var(--component-bg, #fff);
  }
  ```

### ::part()

- **Baseline:** widely available
- **Purpose:** Consumer-facing styling API for web components. The component author exposes named parts; consumers style them from outside.
- **Prefer over:** reaching into shadow DOM with descendant selectors (which doesn't work).
- **Gotcha:** Parts must be explicitly exposed by the component author via the `part` attribute. Only the exposed surface is stylable — this is a feature, not a limitation.
- **Syntax:**

  ```css
  /* Inside the shadow DOM template: */
  /* <button part="control">Click me</button> */

  /* From outside the component: */
  my-component::part(control) {
  	background: var(--accent);
  	border-radius: 0.25rem;
  }
  ```

### ::slotted()

- **Baseline:** widely available
- **Purpose:** Style elements slotted into the shadow DOM from the light DOM. Only matches top-level slotted children, not their descendants.
- **Gotcha:** `::slotted()` only accepts a compound selector — no combinators allowed. `::slotted(h2 span)` and `::slotted(h2 > span)` are both invalid. Only `::slotted(h2)` or `::slotted(.class)` work.
- **Syntax:**
  ```css
  ::slotted(h2) {
  	margin: 0;
  	color: var(--heading-color);
  }
  ::slotted(*) {
  	font-family: inherit;
  }
  ```

### Custom properties (shadow DOM theming)

- **Baseline:** widely available
- **Purpose:** CSS custom properties inherit through shadow DOM boundaries. This is the primary API for theming web components from the outside without breaking encapsulation.
- **Prefer over:** `:host-context()` (deprecated), reaching into shadow DOM, JS-based theme injection.
- **Syntax:**

  ```css
  /* Consumer (outside the component): */
  my-component {
  	--accent: hotpink;
  }

  /* Component (inside shadow DOM): */
  :host {
  	color: var(--accent, dodgerblue);
  }
  button {
  	background: var(--accent, royalblue);
  }
  ```

### @scope

- _(Covered in `cascade.md`. See that leaf for scoping syntax, proximity specificity, and gotchas.)_

## Architectural checks (web component codebases)

When auditing or building in a codebase with many web components:

- **`::part()` exposure audit:** Are components exposing parts? Too many parts create a public API surface that's hard to maintain. Too few force consumers into CSS custom property workarounds. Audit the balance.
- **`:host` consistency:** Do all components set `:host { display: block; }` (or inline-block, flex, etc.)? Inconsistent `:host` display is a common source of layout bugs in Lit codebases. Check for consistent patterns: display, contain, overflow, position.
- **Style duplication:** Are common patterns (scrollable containers, card layouts, list items, empty states) extracted into shared styles/mixins, or reinvented per component? In Lit codebases, shared styles via `adoptedStyleSheets` (Lit's `static styles` array) are the performance-optimal path — styles are parsed once and shared across instances. Check that shared patterns use this mechanism rather than duplicating CSS across components.
- **Dead CSS:** In a codebase with 30+ style files, orphaned rules accumulate. Check for selectors targeting elements/classes that no longer exist.
- **Lit-specific: static styles vs. dynamic.** In Lit codebases, CSS should live in `static styles` (the `css` tagged template) whenever possible — this is parsed once and shared. Dynamic styling via `styleMap()` or `classMap()` should be reserved for values that actually change at runtime. An audit should check whether CSS that belongs in static styles has leaked into render-time logic.

## Anti-patterns in this category

- Reaching into a shadow root with `.my-component .internal-element` — doesn't work. Use `::part`, `::slotted`, or custom properties.
- Using `:focus` for keyboard-visible focus rings. Use `:focus-visible` (see migration strategy above).
- Re-implementing parent-awareness in JS when `:has()` does it natively.
- Using `:host-context()` in cross-browser code. Deprecated and absent from Firefox. Use custom properties inherited through the shadow boundary or explicit attributes on the host.
- `::slotted(div span)` — won't match. `::slotted()` only accepts compound selectors — no combinators.
- Exposing too many `::part` names, creating a large public API surface that's hard to maintain. Expose thoughtfully.
