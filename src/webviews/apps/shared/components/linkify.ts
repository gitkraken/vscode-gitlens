import type { TemplateResult } from 'lit';
import { html } from 'lit';

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
		parts.push(html`<a href=${href}>${label}</a>`);
		lastIndex = match.index + match[0].length;
	} while ((match = linkRegex.exec(text)) != null);

	if (lastIndex < text.length) {
		parts.push(text.substring(lastIndex));
	}
	return parts;
}
