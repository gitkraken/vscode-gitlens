# Webview Styling

Reference for authoring CSS in the GitLens webviews (`src/webviews/apps/`). Covers the foundations every webview shares — the `rem` base, custom-property prefix conventions, and the GitLens design tokens — plus the elevation system (stacking + shadows).

Webview CSS lives in two forms: `.scss` files and Lit `css` template strings inside `.ts` components. The same tokens and conventions apply to both.

> Shared tokens are defined on `:root` in [`shared/styles/tokens.scss`](../src/webviews/apps/shared/styles/tokens.scss) and inherit through shadow DOM into Lit components.

## Foundations

### `1rem = 10px`

The root sets `font-size: 62.5%`, so **`1rem = 10px`**. Multiply any `rem` by 10 to get pixels: `0.4rem = 4px`, `0.8rem = 8px`, `1.2rem = 12px`. `rem` and raw `px` are used interchangeably across the codebase and only line up under this base.

`em` does **not** follow this rule — it's relative to the local `font-size`.

The 62.5% base is set in `shared/base.scss`, `shared/styles/normalize.scss`, and each app's entry SCSS (9 sites total).

### Custom-property prefixes

The prefix signals ownership and intent. Four namespaces, kept separate **by design**:

| Prefix       | Owner        | Use                                                                                                                                                                                                                                                                       |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--gl-*`     | GitLens      | The standard prefix and the namespace to grow — shared GitLens primitives plus component-scoped props (e.g. `--button-padding`).                                                                                                                                          |
| `--vscode-*` | VS Code      | Theme variables; the basis for theme-reactive color and font. **Use directly — don't wrap or alias them.**                                                                                                                                                                |
| `--wa-*`     | WebAwesome   | Theme WebAwesome components only (defined in `shared/styles/shoelace/vscode-theme.scss`; the folder is legacy-named after Shoelace). **Off-limits for general GitLens styling** — intentionally isolated to WebAwesome components, _not_ an unadopted scale to reach for. |
| `--gk-*`     | _deprecated_ | Left over from a removed library; not for new code. A few (`--gk-action-radius` in `properties.scss`) still linger as legacy debt.                                                                                                                                        |

When you need a token VS Code doesn't provide, **derive it from `--vscode-*`** via `color-mix()` or relative color syntax — never hardcode a hex. This keeps the extension responsive to theme changes.

## GitLens tokens (`--gl-*`)

Defined in [`tokens.scss`](../src/webviews/apps/shared/styles/tokens.scss). The _dimensionless_ layer is deliberately thin today — most lengths are hardcoded (see [What has no scale yet](#what-has-no-scale-yet)).

### Typography

| Token             | Value         | Use                                     |
| ----------------- | ------------- | --------------------------------------- |
| `--gl-font-micro` | 1rem / 10px   | tiny badge counts only                  |
| `--gl-font-sm`    | 1.1rem / 11px | secondary metadata, dates, stats, chips |
| `--gl-font-base`  | 1.3rem / 13px | primary body text, messages, controls   |
| `--gl-font-lg`    | 1.4rem / 14px | emphasized headline (commit subject)    |

### Controls & layout

| Token                                | Value  | Use                                                  |
| ------------------------------------ | ------ | ---------------------------------------------------- |
| `--gl-input-border-radius`           | 0.4rem | text-entry control radius (inputs, textareas)        |
| `--gl-max-input`                     | 560px  | AI / action input max-width                          |
| `--gl-panel-padding-left` / `-right` | 1.2rem | detail-panel horizontal padding (hosts may override) |
| `--gitlens-gutter-width`             | 20px   | gutter width (in `properties.scss`)                  |

### What has no scale yet

Spacing, border-radius, and motion (duration/easing) are largely **hardcoded** — there's no shared `--gl-*` scale for them yet. When adding these values:

- **Match the surrounding component's existing values.** Don't invent a new step. (Spacing clusters around a ~2px step: 0.2 / 0.4 / 0.6 / 0.8 / 1.0 / 1.2rem.)
- **Don't reach into `--wa-*`** for a length scale — those are WebAwesome-isolated, not a GitLens scale.

## Elevation

Stacking and shadow share one mental model: the tier names line up 1:1, so a floating surface picks both from the same word — `z-index: var(--gl-z-popover)` pairs with `box-shadow: var(--gl-shadow-popover)`.

### Stacking — `--gl-z-*`

A semantic z-index scale for the few declarations that escape into a shared stacking context.

| Token            | Value | Use                                                         |
| ---------------- | ----- | ----------------------------------------------------------- |
| `--gl-z-buried`  | -2    | deepest — beneath a `behind` layer                          |
| `--gl-z-behind`  | -1    | decorative layer beneath in-flow siblings                   |
| `--gl-z-base`    | 0     | stacking-context anchor (prefer `isolation: isolate`)       |
| `--gl-z-raised`  | 1     | lowest raise in a shared light-DOM context                  |
| `--gl-z-sticky`  | 100   | pinned chrome (sticky headers, toolbars, rails, sashes)     |
| `--gl-z-cover`   | 200   | full-area blocking/dimming scrim over a region              |
| `--gl-z-sheet`   | 300   | panel-scoped modal sheet                                    |
| `--gl-z-popover` | 400   | anchored interactive surface (menus, row-hovers, dropdowns) |
| `--gl-z-tooltip` | 500   | topmost in-document content — never occluded                |

Rules:

- **Shadow-isolated internals need no token.** Keep small raw ordinals (`1` / `2` / `3`) and trap them with the shadow root or `isolation: isolate`.
- **Modals/dialogs are not a tier.** Use the top layer (`<dialog>.showModal()` / `[popover]`), which stacks above the whole scale by insertion order.
- **The `--wa-z-index-*` band (700…1000) sits deliberately above this scale** — it's WebAwesome's floating-surface band (hoisted popovers/tooltips, toasts). Keep the bands disjoint; never interleave.
- **Guard:** a raw z-index climbing past ~100 is the signal to reach for a tier token, `isolation: isolate`, or the top layer — not a bigger number.

### Shadows — `--gl-shadow-*`

A small elevation scale whose tiers mirror the z-tiers. Every shadow derives from `--vscode-widget-shadow` (VS Code's single, pre-multiplied shadow color) and scales per-layer alpha with `color-mix(… N%, transparent)` — which only dials the theme's chosen intensity _down_, so shadows always track the active theme.

| Token                 | Pairs with          | Geometry                  | Example surfaces                              |
| --------------------- | ------------------- | ------------------------- | --------------------------------------------- |
| `--gl-shadow-raised`  | `raised` / `sticky` | 2-layer                   | sticky bars, hover lifts, settings screenshot |
| `--gl-shadow-popover` | `popover` / `cover` | 2-layer                   | popovers, autocomplete, select listbox        |
| `--gl-shadow-sheet`   | `sheet`             | 2-layer, casts **upward** | bottom-anchored detail sheet                  |
| `--gl-shadow-dialog`  | top modal layer     | 2-layer                   | `<dialog>`, `.popup`                          |
| `--gl-shadow-tooltip` | `tooltip`           | single-layer              | tooltips, hover widgets                       |

`--gl-shadow-color` is a **private base** — the single color the layered tokens mix from; never apply it to a surface directly.

`raised` / `popover` / `sheet` / `dialog` are **two-layer** (a tight contact shadow + a soft diffuse one with negative spread) because single-layer shadows look "stuck on" at those heights. `tooltip` stays **single-layer** on purpose, so GitLens hovers match the editor's native hover exactly. There's no numeric ladder and no speculative tiers — "no elevation" is just `box-shadow: none`, and a sticky bar reuses `raised`.

### The `elevated-surface` helper — always go through it

**Never apply a `--gl-shadow-*` token raw.** Use the helper, which pairs the shadow with a border (see [Forced-colors](#forced-colors--high-contrast), below). A lint rule flags raw usage.

**Lit** ([`elevation.css.ts`](../src/webviews/apps/shared/components/styles/lit/elevation.css.ts)) — interpolate the `elevatedSurface` fragment into the elevated rule and set the knobs:

```css
:host {
	--gl-elevation: var(--gl-shadow-popover);
	/* override only for a surface that also wants a border in normal themes: */
	--gl-elevation-border-color: var(--gl-tooltip-border-color);
	/* …interpolate elevatedSurface here… */
}
```

**SCSS** ([`utils.scss`](../src/webviews/apps/shared/styles/utils.scss)) — for plain-SCSS surfaces that can't use a Lit `css` fragment (`.popup`, `settings`):

```scss
.popup {
	@include elevated-surface(var(--gl-shadow-dialog));
}
```

### Forced-colors / high-contrast

This follows VS Code's own widget convention: **shadow in normal themes, border in high-contrast — never both.** In high-contrast themes VS Code leaves `--vscode-widget-shadow` unset, so the `--gl-shadow-*` tiers compute invalid and the shadow vanishes on its own. The helper replaces it with a border keyed on `--vscode-contrastBorder` — the token VS Code leaves **unset in normal themes and set in high-contrast** — so the border self-collapses to nothing in normal themes and appears only in high-contrast.

That self-collapsing default is also what makes it work inside Lit shadow roots, where neither signal VS Code itself uses is reliable: `@media (forced-colors)` reflects only _OS-level_ forced-colors (not a VS-Code-picked HC theme), and an ancestor `.vscode-high-contrast` selector lives _outside_ the shadow boundary. An inherited custom property crosses the boundary and covers both HC paths.

A surface that also wants a border in _normal_ themes (e.g. a dialog or dropdown that's always bordered) overrides `--gl-elevation-border-color` with an always-set color such as `var(--vscode-widget-border)`; that border shows in both themes and survives high-contrast because it's `contrastBorder`-backed.

## Quick guardrails

- **Hardcoded spacing/radius:** match neighboring values — there's no shared scale yet; don't invent steps, and don't reach into `--wa-*`.
- **Custom colors:** derive from `--vscode-*` (`color-mix()` / relative color) — don't hardcode hex.
- **z-index past ~100:** tier token, `isolation: isolate`, or top layer — not a bigger number.
- **Shadows:** never apply `--gl-shadow-*` raw — use the `elevated-surface` helper so the high-contrast border comes with it.
- **Prefixes:** `--vscode-*` used directly; `--wa-*` is WebAwesome-only; `--gk-*` is deprecated.
