# Animation & Interaction

Animation, transitions, scroll-driven effects, view transitions, anchor positioning, and popovers.

## Discipline rules

- Prefer `transition` over `@keyframes` when the motion is state-to-state (A → B).
- Always respect `prefers-reduced-motion`. See `responsive.md` for the media query pattern and severity triage guidance.
- `@property` enables custom-property animation — without it, they silently don't animate. See `theming.md` for declaration syntax.
- Animate compositor-friendly properties (`transform`, `opacity`) whenever possible. Animating layout-triggering properties (`width`, `height`, `top`, `left`, `margin`, `padding`) causes layout recalculation every frame and can jank, especially in VS Code where the webview shares a renderer process with the editor.

## Features

### Scroll-driven animations

- **Baseline:** newly available
- **Purpose:** CSS-native scroll-linked animation without JS. Bind an existing `@keyframes` animation to scroll progress or element visibility.
- **Prefer over:** IntersectionObserver + requestAnimationFrame scroll handlers.
- **Gotcha:** The element must have an animation defined via `animation-name` first. `animation-timeline` then binds it to scroll progress. Two separate concepts that work together. Firefox full support landed later (128) than Chrome (115); Safari 18+.
- **Syntax:**

  ```css
  @keyframes fade-in {
  	from {
  		opacity: 0;
  		transform: translateY(2rem);
  	}
  	to {
  		opacity: 1;
  		transform: translateY(0);
  	}
  }

  .reveal {
  	animation: fade-in linear both;
  	animation-timeline: view();
  	animation-range: entry 0% cover 40%;
  }
  ```

### View transitions (same-document)

- **Baseline:** newly available (Chrome 111+, Safari 18+, Firefox 144+)
- **Purpose:** Animated transitions between page states within a single-page app. The browser snapshots old and new states and cross-fades them.
- **Prefer over:** JS-based FLIP animations for page-state transitions.
- **Syntax:**
  ```css
  ::view-transition-old(root),
  ::view-transition-new(root) {
  	animation-duration: 200ms;
  }
  ```
  ```js
  document.startViewTransition(() => updateDOM());
  ```

### view-transition-name

- **Baseline:** newly available
- **Purpose:** Mark specific elements for shared-element transitions. Named elements animate independently from the root transition, creating the "hero element" effect.
- **Gotcha:** Each `view-transition-name` must be unique on the page at the time of the transition. Duplicate names cause the transition to fail.
- **Syntax:**

  ```css
  .hero-image {
  	view-transition-name: hero;
  }
  .page-title {
  	view-transition-name: title;
  }

  ::view-transition-old(hero),
  ::view-transition-new(hero) {
  	animation-duration: 300ms;
  }
  ```

### @starting-style

- **Baseline:** newly available
- **Purpose:** Define the starting state for transitions when an element first appears (e.g., `display: none → block`, popover opening, element insertion). Replaces JS double-rAF hacks for entry animations.
- **Prefer over:** `requestAnimationFrame(() => requestAnimationFrame(() => { ... }))` tricks.
- **Syntax:**

  ```css
  .popover {
  	opacity: 1;
  	transform: translateY(0);
  	transition:
  		opacity 200ms,
  		transform 200ms,
  		display 200ms allow-discrete;
  }

  @starting-style {
  	.popover {
  		opacity: 0;
  		transform: translateY(-0.5rem);
  	}
  }
  ```

### Anchor positioning

- **Baseline:** newly available
- **Purpose:** Position an element relative to another element without JS coordinate math. Tooltips, popovers, dropdowns anchored to their trigger.
- **Prefer over:** JS `getBoundingClientRect()` + manual positioning. Also replaces Popper.js / Floating UI for basic anchor cases.
- **Gotcha:** Chrome 125+, Firefox 147+, Safari 26+. Firefox and Safari support arrived recently — verify the project's minimum browser targets before relying on it.
- **Syntax:**

  ```css
  .trigger {
  	anchor-name: --my-anchor;
  }

  .tooltip {
  	position: fixed;
  	position-anchor: --my-anchor;
  	top: anchor(bottom);
  	left: anchor(center);
  	translate: -50% 0.5rem;
  }
  ```

### transition-behavior: allow-discrete

- **Baseline:** newly available
- **Purpose:** Enable transitions on properties that aren't normally animatable — most importantly `display` and `overlay`. Makes `display: none → block` transitions work natively.
- **Prefer over:** JS-based show/hide with `setTimeout` for animation timing.
- **Syntax:**
  ```css
  .panel {
  	transition:
  		opacity 200ms,
  		display 200ms allow-discrete;
  }
  .panel[hidden] {
  	opacity: 0;
  	display: none;
  }
  ```

### @property for animatable custom properties

- _(See `theming.md` for `@property` declaration syntax. Key point: without `@property`, transitions on custom properties silently fail.)_

### Popover API

- **Baseline:** newly available
- **Purpose:** Native modeless/modal popover behavior via HTML attribute. Handles light-dismiss, top-layer promotion, and accessibility. Style with CSS; animate entry with `@starting-style`.
- **Prefer over:** custom JS popover/dropdown implementations that reimplement focus trapping and light-dismiss.
- **Gotcha:** `[popover]` elements are in the top layer, which means they escape overflow clipping and stacking contexts. This is usually desirable but can surprise if you expect the popover to clip with its parent.
- **Syntax:**

  ```css
  [popover]:popover-open {
  	opacity: 1;
  	transform: scale(1);
  	transition:
  		opacity 150ms,
  		transform 150ms,
  		display 150ms allow-discrete;
  }

  /* Entry animation starting state: */
  @starting-style {
  	[popover]:popover-open {
  		opacity: 0;
  		transform: scale(0.95);
  	}
  }

  /* Exit animation end state (display: none handled by allow-discrete): */
  [popover]:not(:popover-open) {
  	opacity: 0;
  	transform: scale(0.95);
  }
  ```

## Anti-patterns in this category

- Animation with no `prefers-reduced-motion` fallback. Non-essential motion must be opt-out-able.
- JS scroll handlers for effects that scroll-driven animations now handle natively.
- Trying to animate a custom property without declaring it with `@property`. Transitions silently fail.
- Double-rAF hacks (`requestAnimationFrame(() => requestAnimationFrame(...))`) for entry animations when `@starting-style` is available.
- Heavy `transform` + permanent `will-change` for layer promotion where `isolation: isolate` or `contain` is simpler. See `performance.md`.
- Using Popper.js / Floating UI for basic tooltip anchoring when anchor positioning is available and the target supports it.
- Reimplementing popover behavior (focus trap, light-dismiss, escape handling) in JS when the Popover API handles it natively.
