# Performance & Rendering

Rendering performance, containment, content-visibility, stacking contexts, and compositor hints.

## Discipline rules

- `will-change` is not magic dust. It's a hint for things about to animate. Never apply permanently; never apply broadly.
- Creating a new stacking context is often a feature, not a bug — `isolation: isolate` is the cleanest way.
- `content-visibility: auto` + `contain-intrinsic-size` is a massive win for long lists and offscreen sections.

## Features

### contain

- **Baseline:** widely available
- **Purpose:** Tell the browser this element's rendering is isolated. It can skip layout/paint/size calculations for descendants when they change. Values: `layout`, `paint`, `size`, `style`, `strict` (= size + layout + paint), `content` (= layout + paint).
- **Prefer over:** uncontained elements in performance-sensitive areas (long lists, complex dashboards).
- **When to recommend:** Profile first. Web components with shadow DOM already get implicit style isolation. Adding explicit `contain` tells the browser about layout/paint isolation too, but only matters when you have many sibling elements that trigger frequent recalculation. Don't recommend speculatively.
- **Syntax:**
  ```css
  .card {
  	contain: content;
  }
  .sidebar {
  	contain: strict;
  }
  ```

### content-visibility: auto

- **Baseline:** widely available
- **Purpose:** Skip rendering of offscreen content entirely. The browser defers layout and paint until the element scrolls near the viewport. Major paint performance win for long pages with many offscreen elements.
- **Prefer over:** JS-based virtualized lists for simpler cases (content-visibility is native and declarative).
- **Gotcha:** Must pair with `contain-intrinsic-size` to reserve space. Without it, the scroll bar jumps as offscreen elements collapse to zero height, causing a jarring scroll experience.
- **When to recommend:** Profile first. Only recommend for views with hundreds of offscreen elements in a scrollable container. VS Code webview panels with 20-30 items in a fixed-height view won't see measurable benefit. Don't recommend speculatively.
- **Syntax:**
  ```css
  .long-section {
  	content-visibility: auto;
  	contain-intrinsic-size: auto 500px;
  }
  ```

### contain-intrinsic-size

- **Baseline:** widely available
- **Purpose:** Placeholder size for content whose rendering was skipped by `content-visibility: auto`. The `auto` keyword remembers the last rendered size, preventing scroll jumps on revisit.
- **Syntax:**
  ```css
  .section {
  	content-visibility: auto;
  	contain-intrinsic-size: auto 300px;
  }
  ```

### isolation: isolate

- **Baseline:** widely available
- **Purpose:** Create a new stacking context without side effects. The cleanest way to contain z-index within a component or section.
- **Prefer over:** `transform: translateZ(0)`, `opacity: 0.999`, `position: relative; z-index: 0;`, and other hacks that create stacking contexts as a side effect.
- **Syntax:**
  ```css
  .modal-backdrop {
  	isolation: isolate;
  }
  .card-stack {
  	isolation: isolate;
  }
  ```

### Stacking-context-creating properties (awareness list)

- **Purpose:** Know which properties create a new stacking context — this is how z-index "breaks." A child's z-index can never escape its parent's stacking context.
- **Properties that create a stacking context:**
  - `position: relative` or `position: absolute` with explicit `z-index` (not `auto`)
  - `position: fixed` or `position: sticky`
  - `opacity` less than 1
  - `transform` (any value other than `none`)
  - `filter` (any value other than `none`)
  - `backdrop-filter` (any value other than `none`)
  - `mix-blend-mode` (any value other than `normal`)
  - `isolation: isolate`
  - `will-change` (when specifying properties that would create a stacking context)
  - `contain: layout`, `contain: paint`, `contain: strict`, `contain: content`
  - `container-type: size` or `container-type: inline-size`
  - Elements with a `view-transition-name`
  - `clip-path` (any value other than `none`)
  - `mask` / `mask-image` (any value other than `none`)
  - `perspective` (any value other than `none`)
- **Shadow DOM note:** Each shadow root creates an implicit stacking context. In a web component codebase, z-index values inside one component's shadow DOM do NOT compete with z-index in another component's shadow DOM — they're already isolated. This means many z-index "issues" in Lit/web component codebases are non-issues. When auditing, check which z-indices actually compete (same stacking context) vs. which are already isolated by shadow boundaries.
- **Debugging tip:** When z-index isn't working, walk up the DOM looking for any of these properties on an ancestor. The stacking context is likely trapped inside that ancestor. In shadow DOM codebases, also check whether the competing elements are in the same shadow root.

### will-change (discipline-focused)

- **Baseline:** widely available
- **Purpose:** Hint to the browser about upcoming changes. Promotes the element to its own compositor layer for smoother animation.
- **Gotcha:** Permanent `will-change` is a pessimization — it reserves GPU memory and compositor resources indefinitely. Apply just before animation starts (via a class or hover state), remove after. Most code shouldn't use `will-change` at all.
- **Prefer over:** nothing — default is to not use it. Only add when measured performance justifies it.
- **Syntax:**

  ```css
  /* Only on interaction, not permanently: */
  .card:hover {
  	will-change: transform;
  }

  /* NOT this: */
  /* .card { will-change: transform; } ← permanent = pessimization */
  ```

## Anti-patterns in this category

- `transform: translateZ(0)` or `-webkit-transform: translate3d(0,0,0)` to force a compositor layer. Use `isolation: isolate` or `contain` instead.
- `will-change: transform` on every animated element as a "performance tip." The opposite — it's a pessimization.
- Using `content-visibility: auto` without `contain-intrinsic-size`. Causes scroll bar jumping as offscreen content collapses to zero height.
- Relying on z-index alone to order elements when the real problem is an unexpected stacking context from a parent's `transform`, `filter`, or `opacity`.
- Creating stacking contexts accidentally (e.g., adding `opacity: 0.99` or `transform: translate(0)` just to "fix" z-index) without understanding why it works.
- JS-based scroll virtualization for content that `content-visibility: auto` handles natively.
