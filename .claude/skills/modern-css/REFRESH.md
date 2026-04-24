# Refresh checklist

The `modern-css` skill bakes in static Baseline status for each feature. Run this refresh monthly, or when VS Code bumps its Electron version (which shifts the available feature set).

## Sources

- https://web.dev/baseline
- https://github.com/web-platform-dx/web-features
- https://caniuse.com (for version-specific checks when Baseline is ambiguous)

## Process

1. For each feature listed in `references/*.md`:
   - Verify the Baseline status value (`widely available` / `newly available` / `limited`) matches current data.
   - Update if moved (e.g., `newly available` → `widely available` is common).
2. Check for new features that should be added:
   - New Baseline "newly available" features in scope of an existing leaf → consider adding.
   - Features that have become `widely available` and are commonly missed by AI → consider adding.
3. Update SKILL.md load-bearing rules only if a new, broadly-applicable discipline emerges.
4. If the directory is under version control, commit the refresh with a dated message (e.g., `chore(modern-css): refresh 2026-04`).

## Features currently tracked

- **cascade.md:** @layer, :is(), :where(), :not(), all, revert/revert-layer, @scope
- **layout.md:** container queries, container units, subgrid, clamp(), logical properties, intrinsic sizing, aspect-ratio, gap, place-\*
- **responsive.md:** @container size, @container style(), container units, prefers-reduced-motion, prefers-color-scheme, prefers-contrast, forced-colors, hover/pointer
- **selectors.md:** :has(), :is()/:where()/:not() (cross-ref), :focus-visible, :focus-within, :host, :host(), :host-context() (deprecated), ::part(), ::slotted(), custom properties (shadow DOM), @scope (cross-ref)
- **theming.md:** custom properties, fallback chains, tiering, component API, @property, light-dark(), color-mix(), relative color syntax, color-scheme
- **animation.md:** scroll-driven animations, view transitions, view-transition-name, @starting-style, anchor positioning, transition-behavior allow-discrete, @property (cross-ref), popover API
- **performance.md:** contain, content-visibility, contain-intrinsic-size, isolation: isolate, stacking-context awareness, will-change
