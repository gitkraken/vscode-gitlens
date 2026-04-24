# Shared-Component Rules — Rules 8 and 9 in Full

**Why this file exists:** Shared component libraries (consumed by multiple products) are the highest-leverage place for a11y fixes AND the highest-risk place for broken fixes. A regressed button style in a shared lib ships a visual bug to every consumer simultaneously. A mis-wrapped component creates nested-interactive violations across the codebase.

Use this reference when the detection spine identified the target as a **shared component library**, OR when a Fix involves changing a rendered semantic element, OR when a Fix depends on how an imported wrapper behaves.

---

## Rule 8 — Semantic-element swaps in shared components must address visual regression

When a Fix changes the rendered HTML element in a shared component library (e.g., `<span>` → `<button>`, `<div>` → `<a>`, `<li>` → `<li role="menuitem">`), the Fix MUST address the visual regression risk, because shared components ship to multiple consumers and a default-styled `<button>` in place of a `<span>` will render differently across every consuming product.

### The Fix must do one of:

**Option A — Reference an existing unstyled-element utility.**
Cite the file and show existing usage. Example:

```tsx
// Existing utility (cited: src/components/shared/BaseButton.tsx:12)
<BaseButton onClick={...}>{children}</BaseButton>
```

**Option B — Prescribe a scoped CSS reset.**
Use low-specificity selectors like `:where()` to minimize specificity impact on consumers. Name the CSS file. Example:

```css
/* graph-panel.less */
:where(.columns-btn-reset) {
	background: transparent;
	border: 0;
	padding: 0;
	font: inherit;
	color: inherit;
	cursor: pointer;
}
```

**Option C — Escalate Risk to `High`.**
State plainly: "Converting this element will require a CSS reset that does not exist in this library today. The reset itself is a separate design decision." This forces the decision to the surface instead of hiding in a code comment. Emit a Design Decision block per the output format.

### Banned

A bare `<button>` replacing a `<span>` in a shared library without any of the above is a banned fix — the cosmetic regression in consuming products is a new bug. The audit must refuse to emit this pattern even if the a11y side of the fix is otherwise correct.

### Additional considerations

- **The reset utility itself is a cross-issue dependency.** If Issue A swaps `<span>` #1 and Issue B swaps `<span>` #2 and both need the same reset, they must be in the same Issue Group — one of them adds the utility; the others consume it.
- **Consumer-product grep.** If the element being swapped is exported and used in consumer products (outside the auditable repo), the skill cannot verify downstream impact. Tag Fix Confidence = Low and emit a Design Decision block.

---

## Rule 9 — Fixes depending on an imported wrapper must analyze that wrapper

If a Fix depends on the wrapping/rendering behavior of an imported component (`Icon`, `OverlayTrigger`, `Tooltip`, a design system primitive, etc.) — for example, if the Fix replaces the child of the wrapper or relies on it forwarding props — the skill MUST open the imported component and summarize its behavior in the Fix.

### Required minimum in the Fix

- One or two sentences on what the imported component renders around its children.
- Whether it clones children (`React.cloneElement`, `<slot>`), passes props through, or renders its own interactive wrapper.
- Whether the wrapper itself is already interactive (adding `<button>` inside an already-interactive wrapper creates nested-interactive-elements, which is its own a11y violation).

### Example — good summary

> `Icon` (cited: `src/components/graph/refzone/Icon.tsx:12`) renders a `<span>` wrapping its `icon` prop, passes `title` through to an `OverlayTrigger`, and is NOT interactive itself. Swapping the child from `<span>` to `<button>` does not create nested-interactive elements.

### Example — when to escalate

> `OverlayTrigger` (react-bootstrap) is a third-party component. We could not inspect its internals to confirm whether it clones children or wraps them in an interactive element. `Risk: High — wrapper behavior uninspected; developer must verify no nested-interactive violation before merge.`

### What to check when analyzing the wrapper

1. **Rendering** — does it render its own DOM element around children, or just pass them through?
2. **Interactivity** — does it add event handlers, tabIndex, or role attributes?
3. **Prop forwarding** — does `className`, `onClick`, `aria-*` attributes reach the child?
4. **Children handling** — static rendering? `cloneElement`? Map-and-wrap?
5. **Nested element risk** — if you add `<button>` as the child, will that button end up inside another interactive element (which is a WCAG 4.1.2 violation)?

---

## Common shared-component anti-patterns to catch

### Anti-pattern 1: Exported styled element relied on by consumers

```tsx
// Badge.tsx — exported from the shared library
export function Badge({ children }: Props) {
	return <span className="badge">{children}</span>;
}
```

If a fix changes `<span>` → `<button>` here, every consumer using `<Badge>` gets a button. Any consumer relying on the span's default inline flow (text-wrapping, baseline alignment) will regress.

**Mitigation:** keep the rendered element stable; add a new component or variant (`<BadgeButton>`) rather than mutating the existing one. Flag as Design Decision.

### Anti-pattern 2: Utility class introduced without scoping

```css
/* Added by a naive fix */
button {
	background: none;
	border: 0;
	padding: 0;
}
```

This changes every `<button>` in every consuming product. Instead:

```css
:where(.icon-slot > button) { ... }  /* scoped, low specificity */
```

or use an explicit utility class `.btn-reset` that must be applied intentionally.

### Anti-pattern 3: Wrapping an interactive element in another interactive element

```tsx
// Bad — OverlayTrigger wraps a button with its own clickable wrapper
<OverlayTrigger ... >
  <button>Click me</button>
</OverlayTrigger>
```

If `OverlayTrigger` renders an interactive wrapper (uncommon but possible), this creates nested interactive elements. Verify the wrapper's behavior per Rule 9.

### Anti-pattern 4: Tooltip as the only accessible name

```tsx
<Tooltip title="Close">
	<span onClick={close}>
		<Icon name="x" />
	</span>
</Tooltip>
```

The tooltip provides a visual label but is typically not exposed as an accessible name. Screen readers get no name for the span. Fix: use `aria-label` on the interactive element directly AND keep the tooltip for visual users.
