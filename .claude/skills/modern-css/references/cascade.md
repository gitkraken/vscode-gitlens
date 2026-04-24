# Cascade & Specificity Control

Order, priority, and specificity. Reach for these instead of raising specificity or `!important`.

## Discipline rules

- When a style doesn't apply, fix the cascade — don't escalate specificity.
- `!important` is almost never the answer. Reach for `@layer` or `:where()` first.
- `:is()` and `:where()` are siblings with opposite specificity behavior. Know which you need.

## Features

### @layer

- **Baseline:** widely available
- **Purpose:** Explicit priority bands for cascade control. Declarations inside a layer always lose to later layers, regardless of source order or specificity.
- **Prefer over:** ordering-by-accident, `!important`, deep selector chains for priority.
- **Gotcha:** Unlayered styles beat all layered styles, regardless of layer order or specificity. Put everything in layers if you use layers at all.
- **Syntax:**

  ```css
  @layer reset, base, components, utilities;

  @layer components {
  	.btn {
  		padding: 0.5rem 1rem;
  	}
  }
  ```

### :is()

- **Baseline:** widely available
- **Purpose:** Group selectors without repetition.
- **Prefer over:** repeated selector lists like `header h2, main h2, footer h2`.
- **Gotcha:** Takes the **highest** specificity of its arguments. `:is(#id, p)` has ID-level specificity.
- **Syntax:**
  ```css
  :is(header, main, footer) h2 {
  	margin-block: 1rem;
  }
  ```

### :where()

- **Baseline:** widely available
- **Purpose:** Group selectors with zero specificity. Base/reset styles that should be easy to override.
- **Prefer over:** specificity hacks, deep selector chains for base styles.
- **Gotcha:** Opposite of `:is()` — zero specificity, not highest. Easy to confuse.
- **Syntax:**
  ```css
  :where(h1, h2, h3) {
  	margin: 0;
  }
  ```

### :not()

- **Baseline:** widely available
- **Purpose:** Negation selector. Supports multiple arguments (comma-separated list).
- **Prefer over:** chained `:not():not()` selectors for multi-argument negation.
- **Gotcha:** Takes highest specificity of its argument list (same rule as `:is()`).
- **Syntax:**
  ```css
  button:not([disabled], .secondary) {
  	background: var(--accent);
  }
  ```

### all

- **Baseline:** widely available
- **Purpose:** Reset every property at once. Accepts `initial`, `inherit`, `unset`, `revert`, `revert-layer`.
- **Prefer over:** property-by-property resets when resetting a whole element.
- **Syntax:**
  ```css
  button {
  	all: unset;
  	cursor: pointer;
  }
  ```

### revert / revert-layer

- **Baseline:** widely available
- **Purpose:** Unwind the cascade to a specific point. `revert` rolls back to the previous cascade origin (typically the user-agent stylesheet); `revert-layer` goes back to the previous `@layer`.
- **Prefer over:** hardcoding "default-like" values to undo a style.
- **Syntax:**
  ```css
  .reset-typography {
  	font: revert;
  	color: revert;
  }
  .escape-utility-layer {
  	padding: revert-layer;
  }
  ```

### @scope

- **Baseline:** newly available
- **Purpose:** Scope selectors without shadow DOM. Define a lower bound (`to (...)`) to stop descendant matching.
- **Prefer over:** deeply-nested descendant selectors, BEM workarounds for encapsulation in light DOM.
- **Gotcha:** Proximity wins over specificity inside `@scope` — a closer scope root beats a more specific selector from a farther scope. Also newly available; verify the browser target supports it.
- **Syntax:**
  ```css
  @scope (.card) to (.card-footer) {
  	img {
  		border-radius: 0.5rem;
  	}
  }
  ```

## Anti-patterns in this category

- Reaching for `!important` to "win" a specificity fight. Use `@layer` or rewrite the selector instead.
- Stacking class selectors (`.foo.foo.foo`) to bump specificity artificially.
- Putting every style into one global cascade and hoping source order works out. Use `@layer` to make intent explicit.
- Using `:is()` where you wanted zero specificity. That's `:where()`.
- Using `@scope` on a project whose browser target doesn't support it yet. Check Baseline status against the detected target.
