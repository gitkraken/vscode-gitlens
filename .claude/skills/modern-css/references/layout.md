# Layout & Sizing

Grid, flex, sizing, and positioning. Modern defaults for structural CSS.

## Discipline rules

- Prefer intrinsic sizing (`min-content`, `fit-content`, `clamp()`) over fixed pixel widths.
- Use logical properties by default. They're more expressive (`margin-inline: auto` vs. `margin-left: auto; margin-right: auto`; `padding-block: 1rem` vs. `padding-top: 1rem; padding-bottom: 1rem`) and provide cleaner shorthands. RTL readiness is a bonus, not the primary reason.
- Reach for `gap` over margins on children. Works in grid and flex (also multicolumn via `column-gap`).

## Features

### Container queries (basics)

- **Baseline:** widely available
- **Purpose:** Component-level responsive behavior. The component adapts to the space it's in, not the viewport.
- **Prefer over:** viewport media queries on components.
- **Gotcha:** The parent needs `container-type: inline-size` (or `size`) before `@container` queries work. This also establishes a new containing block — absolutely positioned descendants will resolve against this element, which can break existing layouts.
- **Syntax:**

  ```css
  .card-wrapper {
  	container-type: inline-size;
  }

  @container (min-width: 400px) {
  	.card-body {
  		flex-direction: row;
  	}
  }
  ```

### Container units

- **Baseline:** widely available
- **Purpose:** Size relative to a container, not the viewport. `cqw`/`cqh` for width/height, `cqi`/`cqb` for inline/block, `cqmin`/`cqmax` for the smaller/larger of `cqi` and `cqb`.
- **Prefer over:** viewport units (`vw`, `vh`) inside components.
- **Syntax:**
  ```css
  .card-title {
  	font-size: clamp(1rem, 3cqi, 1.5rem);
  }
  ```

### Subgrid

- **Baseline:** widely available (March 2026)
- **Purpose:** Child grid aligns to parent grid tracks. Children can participate in the parent's grid without duplicating track definitions.
- **Prefer over:** complex `calc()`-based alignment across nested grids.
- **Gotcha:** Both the parent and child must be `display: grid`. The child must also span the parent tracks it wants to inherit (via `grid-column` or `grid-row`). Without explicit track spanning, `subgrid` has nothing to align to.
- **Syntax:**
  ```css
  .parent {
  	display: grid;
  	grid-template-columns: 1fr 2fr 1fr;
  }
  .child {
  	display: grid;
  	grid-template-columns: subgrid;
  	grid-column: span 3;
  }
  ```

### clamp()

- **Baseline:** widely available
- **Purpose:** Fluid sizing with min/max bounds in a single expression.
- **Prefer over:** media-query stepping for font sizes, widths, or spacing.
- **Syntax:**
  ```css
  font-size: clamp(1rem, 2vw + 0.5rem, 2rem);
  ```

### Logical properties

- **Baseline:** widely available
- **Purpose:** Write-mode-agnostic sizing and positioning. Works correctly in RTL, vertical writing modes, and mixed-direction layouts.
- **Prefer over:** `left`/`right`/`top`/`bottom` unless physical direction is specifically intended.
- **Syntax:**
  ```css
  .card {
  	margin-inline: auto;
  	padding-block: 1rem;
  	inset-inline: 0;
  	border-inline-start: 3px solid var(--accent);
  }
  ```

### Intrinsic sizing keywords

- **Baseline:** widely available
- **Purpose:** Sizing that reflects content rather than predetermined boxes. `min-content`, `max-content`, `fit-content`, `auto`.
- **Prefer over:** hardcoded pixel widths on fluid content.
- **Syntax:**
  ```css
  .tag {
  	width: fit-content;
  }
  .grid {
  	grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr));
  }
  ```

### aspect-ratio

- **Baseline:** widely available
- **Purpose:** Maintain proportions declaratively.
- **Prefer over:** `padding-top: 56.25%` aspect-ratio hack.
- **Syntax:**
  ```css
  .video-wrapper {
  	aspect-ratio: 16 / 9;
  }
  .avatar {
  	aspect-ratio: 1;
  	border-radius: 50%;
  }
  ```

### gap (in flex and grid)

- **Baseline:** widely available
- **Purpose:** Spacing between children without margin juggling.
- **Prefer over:** margin on children + `:last-child` / `:first-child` margin resets.
- **Syntax:**
  ```css
  .stack {
  	display: flex;
  	flex-direction: column;
  	gap: 1rem;
  }
  ```

### place-content / place-items / place-self

- **Baseline:** widely available
- **Purpose:** Shorthand for `align-*` + `justify-*`. A single value sets both axes; two values set align then justify.
- **Prefer over:** writing separate `align-*` and `justify-*` declarations.
- **Syntax:**
  ```css
  .center-everything {
  	display: grid;
  	place-content: center;
  }
  ```

## Anti-patterns in this category

- Fixed-pixel widths on fluid content. Let it be intrinsic.
- `margin-left: auto; margin-right: auto;` (or `margin: 0 auto`) when `margin-inline: auto` exists.
- Media queries on a card component to change its layout. The card doesn't know the viewport; it knows its container.
- `padding-top: 56.25%` aspect-ratio hack. Use `aspect-ratio`.
- Margin-based spacing between children when `gap` works.
- `left: 0; right: 0;` when `inset-inline: 0` exists.
