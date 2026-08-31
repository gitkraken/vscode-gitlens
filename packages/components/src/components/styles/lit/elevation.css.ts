import { css } from 'lit';

/**
 * Elevation-surface contract for floating Lit components — the sanctioned way to apply a
 * `--gl-shadow-*` tier (a lint rule flags raw use). Set `--gl-elevation` on the elevated rule and
 * interpolate this fragment into it.
 *
 * Hosts map `--color-contrast-border` to their high-contrast-only border token and leave it
 * transparent in normal themes. Override `--gl-elevation-border-color` with an always-set color for
 * a surface that also wants a border in normal themes.
 *
 *     :host { --gl-elevation: var(--gl-shadow-popover); [elevatedSurface] }
 *
 * Full contract: docs/webview-styling.md (Elevation).
 */
export const elevatedSurface = css`
	border: var(--gl-border-width) solid var(--gl-elevation-border-color, var(--color-contrast-border, transparent));
	box-shadow: var(--gl-elevation);
`;
