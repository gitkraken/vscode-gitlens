# Responsive Strategy

Adapting to context — viewport, container, user preferences, device capabilities. Choosing the right query type for the situation.

## Discipline rules

- Components use container queries. Pages use media queries. Don't mix.
- Preference media (`prefers-*`) and capability media (`hover`, `pointer`) are always media queries, regardless of component or page context.
- Respect `prefers-reduced-motion`. Wrap non-essential animations in it.

## Features

### @container (size queries)

- **Baseline:** widely available
- **Purpose:** Component responds to its own container's size, not the viewport.
- **Prefer over:** viewport media queries on component-level layout.
- **Gotcha:** Requires `container-type: inline-size` (or `size`) on the parent. See `layout.md` for setup details and the containing-block side effect.
- **Syntax:**

  ```css
  .wrapper {
  	container-type: inline-size;
  }

  @container (min-width: 400px) {
  	.content {
  		grid-template-columns: 1fr 1fr;
  	}
  }
  ```

### @container style() queries

- **Baseline:** limited — Chrome 111+, Safari 18+, **no Firefox support**. Partial support only (custom property values in `style()` queries).
- **Purpose:** Component responds to a container's custom property values. Enables theming and state propagation without JS.
- **Prefer over:** JS-based context detection, prop drilling for visual states.
- **Gotcha:** No Firefox support. Style containers are implicit — every element is a style container by default, so `container-type` is NOT required for style queries (only for size queries). The query resolves against the nearest ancestor container that has the custom property set. Use only when the project's browser target allows it.
- **Syntax:**

  ```css
  .wrapper {
  	--density: compact;
  }

  @container style(--density: compact) {
  	.item {
  		padding: 0.25rem;
  	}
  }
  ```

### Container units

- **Baseline:** widely available
- **Purpose:** Size relative to a container. Use inside container-queried components instead of viewport units.
- **Syntax:**
  ```css
  .card-title {
  	font-size: clamp(1rem, 3cqi, 1.5rem);
  }
  ```
- _(See `layout.md` for full unit definitions: `cqw`/`cqh`, `cqi`/`cqb`, `cqmin`/`cqmax`.)_

### prefers-reduced-motion

- **Baseline:** widely available
- **Purpose:** Detect when the user has requested reduced motion. Disable or reduce non-essential animation.
- **Prefer over:** assuming all users tolerate motion.
- **Severity triage:** Not all motion is equal. Spatial motion (slide, bounce, expand) is high severity. Continuous/looping animation (spinners, shimmers) is high severity. Opacity-only fades under 200ms are low severity. Triage by motion type when auditing, not by instance count.
- **Implementation strategy:** In component codebases, create a shared mixin or utility that gates motion, rather than wrapping each animation individually. Alternatively, a global blanket reset (below) covers everything — then opt specific essential animations back in.
- **Note on `!important`:** The global blanket reset below uses `!important`. This is one of the rare legitimate uses — it's a user-preference override that must win against any specificity, including inline styles from JS animation libraries. This does not contradict the "never use `!important`" rule; that rule targets specificity hacks, not accessibility overrides.
- **Syntax:**

  ```css
  /* Global blanket reset (covers all animations): */
  @media (prefers-reduced-motion: reduce) {
  	*,
  	*::before,
  	*::after {
  		animation-duration: 0.01ms !important;
  		animation-iteration-count: 1 !important;
  		transition-duration: 0.01ms !important;
  	}
  }

  /* Per-element (when you need finer control): */
  .panel {
  	transition: transform 200ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
  	.panel {
  		transition: opacity 200ms ease;
  	} /* replace spatial with fade */
  }
  ```

### prefers-color-scheme

- **Baseline:** widely available
- **Purpose:** Detect the user's system light/dark preference.
- **Prefer over:** JS theme detection for initial paint. For simpler cases, consider `light-dark()` from `theming.md`.
- **Syntax:**
  ```css
  @media (prefers-color-scheme: dark) {
  	:root {
  		--bg: #1a1a1a;
  		--text: #eee;
  	}
  }
  ```

### prefers-contrast

- **Baseline:** widely available
- **Purpose:** Detect when the user requests more or less contrast.
- **Syntax:**
  ```css
  @media (prefers-contrast: more) {
  	:root {
  		--border-color: CanvasText;
  		--bg-subtle: Canvas;
  	}
  }
  ```

### forced-colors

- **Baseline:** widely available
- **Purpose:** Detect Windows high-contrast / forced-color mode. Use system-color keywords inside.
- **Gotcha:** Many CSS properties are overridden by the UA in forced-colors mode. Custom backgrounds, box-shadows, and non-text colors may be ignored. Use system-color keywords (`CanvasText`, `Canvas`, `LinkText`, `ButtonFace`, etc.) for anything that must remain visible.
- **Syntax:**
  ```css
  @media (forced-colors: active) {
  	.custom-checkbox {
  		border: 2px solid CanvasText;
  		forced-color-adjust: none; /* opt out selectively, with care */
  	}
  }
  ```

### hover / pointer / any-hover / any-pointer

- **Baseline:** widely available
- **Purpose:** Detect device input capabilities. `hover: hover` = device has hover; `pointer: fine` = precise pointer (mouse); `pointer: coarse` = imprecise (touch). `any-hover`/`any-pointer` check across all input devices.
- **Prefer over:** user-agent sniffing for device type.
- **Gotcha:** On touch devices, `:hover` can "stick" after a tap. Gate hover-only affordances (tooltips, hover reveals) behind `@media (hover: hover)`.
- **Syntax:**

  ```css
  @media (hover: hover) and (pointer: fine) {
  	.row:hover {
  		background: var(--hover-bg);
  	}
  }

  @media (pointer: coarse) {
  	.tap-target {
  		min-height: 44px;
  		min-width: 44px;
  	}
  }
  ```

## Anti-patterns in this category

- Assuming hover works everywhere. On touch, `:hover` can stick after tap. Gate behind `@media (hover: hover)`.
- Animation with no `prefers-reduced-motion` check. Non-essential motion must be opt-out-able.
- Dark mode via JS-based theme detection when `prefers-color-scheme` or `light-dark()` handles it cheaper.
- Media queries on component layout when the component's container is the real frame of reference.
- Ignoring `forced-colors` mode — form controls and indicators that rely on color alone become invisible.
- Using viewport units inside components instead of container units.
