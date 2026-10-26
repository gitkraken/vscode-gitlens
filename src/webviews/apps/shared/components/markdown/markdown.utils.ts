import type { RendererObject, RendererThis, Tokens } from 'marked';

const escapeReplacements: { [index: string]: string } = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};
const getEscapeReplacement = (ch: string) => escapeReplacements[ch];

export function escape(html: string, encode?: boolean): string {
	if (encode) {
		if (/[&<>"']/.test(html)) {
			return html.replace(/[&<>"']/g, getEscapeReplacement);
		}
	} else if (/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/.test(html)) {
		return html.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, getEscapeReplacement);
	}

	return html;
}

const untrustedLinkProtocols = new Set(['http:', 'https:', 'mailto:']);

/**
 * The normalized URL an untrusted link may point at, or `undefined` when it must not become a link — anything
 * that isn't an absolute `http:`, `https:` or `mailto:` URL (e.g. `command:`, `javascript:`, `file:`, relative).
 *
 * This is the policy for inline links within untrusted content. Callers gating a button or call-to-action
 * may want something stricter (e.g. `https:` only).
 */
export function getUntrustedLinkHref(href: string | null | undefined): string | undefined {
	if (!href || !URL.canParse(href)) return undefined;

	const url = new URL(href);
	return untrustedLinkProtocols.has(url.protocol) ? url.href : undefined;
}

/**
 * Renderer overrides for markdown from an untrusted source (e.g. server-sent notifications): links only for
 * `http:`, `https:` and `mailto:` (otherwise just their text), no images, and raw HTML shown as escaped text.
 */
export const untrustedMarkdownRenderer: Pick<Required<RendererObject>, 'html' | 'image' | 'link'> = {
	html: function (this: RendererThis, { text }: Tokens.HTML | Tokens.Tag): string {
		return escape(text, true);
	},
	image: function (): string {
		return '';
	},
	link: function (this: RendererThis, { href, title, tokens }: Tokens.Link): string {
		const text = this.parser.parseInline(tokens);

		const safeHref = getUntrustedLinkHref(href);
		if (safeHref == null) return text;

		return `<a href="${escape(safeHref, true)}"${title ? ` title="${escape(title, true)}"` : ''}>${text}</a>`;
	},
};
