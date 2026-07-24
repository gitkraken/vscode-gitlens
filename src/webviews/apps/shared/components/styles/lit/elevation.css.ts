import { css } from 'lit';

/**
 * Elevation-surface contract for floating Lit components — the sanctioned way to apply a
 * `--gl-shadow-*` tier (a lint rule flags raw use). Set `--gl-elevation` on the elevated rule and
 * interpolate this fragment into it.
 *
 * Mirrors VS Code's widget pattern — shadow in normal themes, border in high-contrast, never both —
 * and gets it for free inside a shadow root: the default border color `--vscode-contrastBorder` is
 * unset in normal themes (so the border self-collapses to nothing) and set in high-contrast (so it
 * appears), while the shadow vanishes on its own there because `--vscode-widget-shadow` is unset
 * (the `--gl-shadow-*` color-mix then computes invalid). No `@media (forced-colors)` (it misses VS
 * Code HC themes) or ancestor `.vscode-high-contrast` selector (it's outside the shadow boundary)
 * needed — an inherited custom property covers both HC paths. Override `--gl-elevation-border-color`
 * with an always-set color (e.g. var(--vscode-widget-border)) for a surface that also wants a
 * border in normal themes.
 *
 *     :host { --gl-elevation: var(--gl-shadow-popover); [elevatedSurface] }
 *
 * Full contract: docs/webview-styling.md (Elevation).
 */
export const elevatedSurface = css`
	border: var(--gl-border-width) solid var(--gl-elevation-border-color, var(--vscode-contrastBorder));
	box-shadow: var(--gl-elevation);
`;
