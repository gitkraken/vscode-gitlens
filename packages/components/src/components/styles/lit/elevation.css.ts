import type { CSSResult } from 'lit';
import { css } from 'lit';

/**
 * Elevation-surface contract for floating Lit components — the sanctioned way to apply a
 * `--gl-shadow-*` tier (a lint rule flags raw use). Set `--gl-elevation` on the elevated rule and
 * interpolate this fragment into it.
 *
 * Hosts map `--color-contrast-border` to their high-contrast-only border token and leave it UNSET in
 * normal themes — no fallback here, so an unset `--color-contrast-border` is invalid at computed-value
 * time and the whole `border` declaration collapses to nothing rather than painting a real (if
 * invisible) `transparent` border. Override `--gl-elevation-border-color` with an always-set color for
 * a surface that also wants a border in normal themes.
 *
 *     :host { --gl-elevation: var(--gl-shadow-popover); [elevatedSurface] }
 *
 * Full contract: docs/webview-styling.md (Elevation).
 */
export const elevatedSurface: CSSResult = css`
	border: var(--gl-border-width) solid var(--gl-elevation-border-color, var(--color-contrast-border));
	box-shadow: var(--gl-elevation);
`;
