/**
 * gl-file-icon — renders a file icon from the bundled Seti icon theme font.
 *
 * Accepts a filename, resolves the icon internally from the Seti mapping,
 * and renders the appropriate font glyph with color.
 */

import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { cspStyleMap } from '../csp-style-map.directive.js';
import { resolveSetiFileIcon } from './seti-icons.js';

@customElement('gl-file-icon')
export class GlFileIcon extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: var(--gl-file-icon-size, 16px);
			height: var(--gl-file-icon-size, 16px);
			vertical-align: text-bottom;
		}

		.font-icon {
			display: inline-block;
			font-family: 'seti';
			font-size: var(--gl-file-icon-size, 16px);
			line-height: 1;
			text-align: center;
			-webkit-font-smoothing: antialiased;
			-moz-osx-font-smoothing: grayscale;
		}
	`;

	@property()
	filename?: string;

	override render(): unknown {
		if (this.filename == null) return nothing;

		const isLight =
			document.body.classList.contains('vscode-light') ||
			document.body.classList.contains('vscode-high-contrast-light');
		const icon = resolveSetiFileIcon(this.filename, isLight);
		if (icon == null) return nothing;

		// Color is inheritable — apply on the span directly via `cspStyleMap` (CSSOM) since the
		// webview CSP forbids inline `style="…"` attributes.
		return html`<span class="font-icon" style=${cspStyleMap({ color: icon.color || 'inherit' })}
			>${parseFontCharacter(icon.character)}</span
		>`;
	}
}

/**
 * Parse a font character string like "\\E001" into the actual Unicode character.
 */
function parseFontCharacter(char: string): string {
	if (char.length === 1) return char;

	const match = /^\\+(?:u)?([0-9a-fA-F]{4,6})$/.exec(char);
	if (match != null) {
		return String.fromCodePoint(parseInt(match[1], 16));
	}

	return char;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-file-icon': GlFileIcon;
	}
}
