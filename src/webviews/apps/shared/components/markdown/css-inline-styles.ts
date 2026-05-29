// The webview `style-src` CSP forbids inline styles (no `'unsafe-inline'`), so any `style="…"`
// attribute the browser parses is blocked. Host-generated markdown (commit hovers, autolinks)
// embeds inline-styled `<span>`s for VS Code's native renderer; when rendered here via
// `unsafeHTML` those attributes trip the CSP. These helpers move such styles off the `style`
// attribute and re-apply them through CSSOM, which the CSP does not restrict — the same approach
// as the `cspStyleMap` directive, but for raw HTML strings rather than Lit attribute bindings.

const inlineStyleAttrRegex = /\sstyle\s*=\s*("[^"]*"|'[^']*')/gi;

const important = 'important';
const importantSuffixRegex = /\s*!important\s*$/i;

/**
 * Rewrites every inline `style="…"`/`style='…'` attribute in `html` to `data-gl-style="…"`,
 * preserving the quoted value verbatim. This keeps the markup inert (the browser never parses an
 * inline style, so no CSP violation) while leaving the declarations available for {@link applyCspSafeStyles}
 * to re-apply via CSSOM after render. Pure attribute rename — it never decodes or re-encodes the
 * value, so it cannot introduce injection and leaves the surrounding tag structure unchanged.
 */
export function rewriteInlineStylesToData(html: string): string {
	if (!html.includes('style')) return html;
	return html.replace(inlineStyleAttrRegex, ' data-gl-style=$1');
}

/**
 * Applies a CSS declaration string (e.g. `color:red;background-color:var(--x)`) to an element via
 * CSSOM `setProperty`, honoring a trailing `!important` per declaration. Always uses `setProperty`
 * (never `style.cssText` or `setAttribute('style', …)`, both of which re-trigger the `style-src` CSP).
 */
export function applyCspSafeStyles(el: HTMLElement | SVGElement, text: string): void {
	for (const declaration of text.split(';')) {
		const colon = declaration.indexOf(':');
		if (colon === -1) continue;

		const name = declaration.slice(0, colon).trim();
		if (!name) continue;

		let value = declaration.slice(colon + 1).trim();
		if (!value) continue;

		let priority = '';
		if (importantSuffixRegex.test(value)) {
			value = value.replace(importantSuffixRegex, '');
			priority = important;
		}

		el.style.setProperty(name, value, priority);
	}
}
