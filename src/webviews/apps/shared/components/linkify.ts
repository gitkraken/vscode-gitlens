import type { TemplateResult } from 'lit';
import { html } from 'lit';

/** Schemes safe to emit as an `href` — Lit does not sanitize attribute bindings. */
const safeLinkSchemes = new Set(['http:', 'https:', 'mailto:', 'command:']);

/**
 * Whether a link target is safe to render as an `href`. Absolute targets must use
 * an allowlisted scheme; scheme-less (relative) targets are allowed since they
 * can't execute script — but a stray colon that a browser might still parse as a
 * scheme is rejected, blocking `javascript:`/`data:` and control-char smuggling.
 */
function isSafeHref(href: string): boolean {
	const trimmed = href.trim();
	const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(trimmed);
	if (scheme != null) return safeLinkSchemes.has(scheme[1].toLowerCase());
	return !trimmed.includes(':');
}

/**
 * Renders plain text containing markdown-style `[text](target)` links as Lit
 * content — `command:` URIs and regular URLs both work (command URIs are
 * enabled for all GitLens webviews). Everything else renders as plain text;
 * this is deliberately not a markdown renderer.
 */
export function linkify(text: string): string | (string | TemplateResult)[] {
	const linkRegex = /\[([^\]]+)\]\(([^()\s]+)\)/g;

	let match = linkRegex.exec(text);
	if (match == null) return text;

	const parts: (string | TemplateResult)[] = [];
	let lastIndex = 0;
	do {
		if (match.index > lastIndex) {
			parts.push(text.substring(lastIndex, match.index));
		}
		const [, label, href] = match;
		// Reject unsafe schemes — keep the literal `[text](target)` as plain text
		// rather than emitting an anchor that could carry a `javascript:` payload
		parts.push(isSafeHref(href) ? html`<a href=${href}>${label}</a>` : match[0]);
		lastIndex = match.index + match[0].length;
	} while ((match = linkRegex.exec(text)) != null);

	if (lastIndex < text.length) {
		parts.push(text.substring(lastIndex));
	}
	return parts;
}
