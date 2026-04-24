# Theming & Color

Color, custom properties, theming, dark/light adaptation, and token authoring. Covers both design-system token patterns and modern CSS color features.

## Discipline rules

- Prefer semantic tokens over primitives in component code. Primitives exist to define semantics, not to be consumed directly.
- Name by role (`--color-accent`), not appearance (`--blue`). If you'd rename it on a rebrand, it's named wrong.
- In VS Code extensions, use `--vscode-*` tokens directly for the semantics they're intended for — don't alias or wrap them. But VS Code's token set is narrow; extension authors often need their own properties. When creating custom tokens, derive from `--vscode-*` using CSS color functions (`color-mix()`, relative color syntax) rather than hardcoding values. This keeps the extension responsive to theme changes.
- Custom properties pierce shadow DOM boundaries — this is why they're the right theming API for web components.
- In VS Code high-contrast themes, `forced-colors: active` applies and system colors override custom values. Test webview components under VS Code's "High Contrast" theme. See `responsive.md` for `forced-colors` details.

## Features

### Custom properties (basics)

- **Baseline:** widely available
- **Purpose:** User-defined cascading and inheriting properties. The foundation of all CSS-based theming. Scope declarations to specific selectors for locality, not always `:root`.
- **Prefer over:** preprocessor variables (Sass/Less) that don't cascade or respond to runtime context.
- **Syntax:**
  ```css
  .card {
  	--accent: var(--color-accent, royalblue);
  	color: var(--accent);
  	border-inline-start: 3px solid var(--accent);
  }
  ```

### Custom property fallback chains

- **Baseline:** widely available
- **Purpose:** Multi-level fallbacks for resilient theming. The innermost fallback is a literal value; outer levels reference other custom properties.
- **Syntax:**
  ```css
  color: var(--button-text, var(--color-on-primary, white));
  ```

### Custom property tiering

- **Purpose:** A design system has three layers:
  - **Primitive tokens:** raw values — `--color-blue-500: #2563eb`.
  - **Semantic tokens:** role-based, reference primitives — `--color-accent: var(--color-blue-500)`.
  - **Component tokens:** scoped to a component — `--button-primary-bg: var(--color-accent)`.
- **Rule:** Component code consumes semantic or component tokens, not primitives. Exception: components whose purpose is to display raw values (e.g., a color swatch).
- **Convention:** Match the project's existing naming convention (casing, prefix, tier structure). If the project uses `--gl-space-md`, follow that pattern.

### Custom properties as component API

- **Baseline:** widely available
- **Purpose:** Expose the component's tunable surface via custom properties. Consumers override them without breaking encapsulation. Works across shadow DOM boundaries.
- **Syntax:**

  ```css
  /* Component definition: */
  :host {
  	--button-bg: var(--color-accent, slateblue);
  	--button-text: var(--color-on-accent, white);
  	--button-radius: 0.25rem;
  }
  button {
  	background: var(--button-bg);
  	color: var(--button-text);
  	border-radius: var(--button-radius);
  }

  /* Consumer override: */
  my-button {
  	--button-bg: hotpink;
  }
  ```

### @property

- **Baseline:** newly available
- **Purpose:** Typed custom properties with declared syntax, initial value, and inheritance behavior. Enables animating custom properties (which silently fail to animate without `@property`).
- **Prefer over:** untyped custom properties when animation or strict type checking is needed.
- **Gotcha:** Without `@property`, transitions on custom properties silently do nothing. If an animation isn't working on a custom property, a missing `@property` declaration is the first thing to check.
- **Syntax:**

  ```css
  @property --angle {
  	syntax: '<angle>';
  	inherits: false;
  	initial-value: 0deg;
  }

  .spinner {
  	--angle: 0deg;
  	transition: --angle 500ms;
  }
  .spinner:hover {
  	--angle: 360deg;
  }
  ```

### light-dark()

- **Baseline:** newly available
- **Purpose:** Inline light/dark value selection without a media query. Returns the first value in light mode, the second in dark mode.
- **Prefer over:** separate `prefers-color-scheme` media blocks for simple value swaps.
- **Gotcha:** Requires `color-scheme: light dark` on `:root` (or an ancestor) to function. Without it, `light-dark()` always returns the light value.
- **Syntax:**

  ```css
  :root {
  	color-scheme: light dark;
  }

  body {
  	background: light-dark(#fff, #1a1a1a);
  	color: light-dark(#111, #eee);
  }
  ```

### color-mix()

- **Baseline:** widely available
- **Purpose:** Compute color blends inline. Mix two colors in a specified color space with a given ratio.
- **Prefer over:** Sass color functions, JS-based color math, preprocessor-computed hex values.
- **Syntax:**
  ```css
  .hover-bg {
  	background: color-mix(in oklch, var(--accent) 80%, white);
  }
  .translucent {
  	background: color-mix(in srgb, var(--accent) 50%, transparent);
  }
  ```

### Relative color syntax

- **Baseline:** newly available
- **Purpose:** Derive new colors from existing ones by manipulating individual channels. Works in any CSS color function.
- **Prefer over:** maintaining parallel color scales manually.
- **Gotcha:** Safari supported this only in lch/oklch/lab/oklab from 15.4–17.x. Full support across all color functions arrived in Safari 18. Prefer oklch for widest compatibility.
- **Syntax:**

  ```css
  /* 50% alpha version of accent: */
  color: rgb(from var(--accent) r g b / 0.5);

  /* Lighten in oklch: */
  color: oklch(from var(--accent) calc(l + 0.1) c h);

  /* Desaturate: */
  color: oklch(from var(--accent) l calc(c * 0.5) h);
  ```

### color-scheme

- **Baseline:** widely available
- **Purpose:** Opt in to UA-supplied dark/light defaults for form controls, scrollbars, and system colors. Also enables `light-dark()`.
- **Prefer over:** manually restyling every form control for dark mode.
- **Gotcha:** Can be set per-element, not only `:root`. Use `color-scheme: only dark` on a container to force dark-scheme UA defaults within it, even if the page is light.
- **Syntax:**
  ```css
  :root {
  	color-scheme: light dark;
  }
  ```

## Anti-patterns in this category

- Naming tokens by appearance: `--blue`, `--yellow`, `--gray-30`. Freezes the design to its first palette.
- Using primitives in component code: `color: var(--color-blue-500)` instead of `color: var(--color-accent)`.
- Wrapping `--vscode-*` tokens in aliases when the original semantic fits. Use them directly. When you need a custom token that VS Code doesn't provide, derive it from `--vscode-*` via `color-mix()` or relative color syntax — don't hardcode a hex.
- Hardcoding hex values when a token (explicit or implicit) is available. Three cases to distinguish: (a) the value should _be_ a token (repeated semantic value — create the token), (b) the value should _derive from_ a token via `color-mix()` or relative color syntax (opacity/lightness variant — use the function), (c) intentionally absolute (shadows, syntax highlighting, one-off decorative — leave it alone). Only (a) and (b) need action.
- Defining all custom properties on `:root` when scoping to a component or section would be more maintainable.
- Trying to animate a custom property without declaring it with `@property`. Transitions silently fail.
- Using `light-dark()` without setting `color-scheme: light dark` — always returns the light value.
