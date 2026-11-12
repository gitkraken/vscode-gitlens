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

/** A literal prefix whose scheme is unambiguous, so the common case skips decoding and URL parsing. It may only
 *  ever short-circuit to "not a command link" — anything that doesn't match takes the full path. */
const nonCommandLinkPrefixRegex = /^(?:https?:\/\/|mailto:)/i;
/** Character references that can contribute to a URL scheme: numeric ones (any character), plus the named ones
 *  for `:`, tab and newline. No named reference expands to an ASCII letter, so none else can spell a scheme. The
 *  trailing `;` is optional so this decodes at least everything the browser would (over-decoding can only make a
 *  link look like a command link, never hide one). */
const schemeCharacterReferenceRegex = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(colon|Tab|NewLine));?/g;

function decodeSchemeCharacterReference(_: string, decimal?: string, hex?: string, named?: string): string {
	switch (named) {
		case 'colon':
			return ':';
		case 'Tab':
			return '\t';
		case 'NewLine':
			return '\n';
	}

	const codePoint = decimal != null ? parseInt(decimal, 10) : parseInt(hex ?? '', 16);
	// The browser maps NUL, surrogates and out-of-range values to U+FFFD (and 0x80-0x9F to non-ASCII characters),
	// none of which can form part of a scheme
	if (!(codePoint > 0 && codePoint <= 0x10ffff) || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return '\ufffd';

	return String.fromCodePoint(codePoint);
}

/**
 * The id of the command a link runs when clicked, or `undefined` when it isn't a `command:` link.
 *
 * Classifies the href the way the browser will resolve it rather than by its literal text: character references are
 * decoded, leading/trailing control characters and spaces and any embedded tab/newline are ignored, and the scheme
 * is case-insensitive. The id is the URI's path — everything after `command:` up to any `?` query (the command's
 * arguments) or `#` fragment.
 */
export function getCommandLinkId(href: string | null | undefined): string | undefined {
	if (!href || nonCommandLinkPrefixRegex.test(href)) return undefined;

	if (href.includes('&')) {
		href = href.replace(schemeCharacterReferenceRegex, decodeSchemeCharacterReference);
	}

	// No colon, no scheme — a relative link
	if (!href.includes(':') || !URL.canParse(href)) return undefined;

	const url = new URL(href);
	return url.protocol === 'command:' ? url.pathname : undefined;
}

/**
 * Renderer override for links within trusted markdown: a `command:` link renders only when its command id is one of
 * `allowedCommands` (exact match), otherwise just as its text. Every other link falls through to marked's default
 * rendering unchanged.
 */
export function getCommandLinkRenderer(
	allowedCommands: ReadonlySet<string> | undefined,
): Pick<Required<RendererObject>, 'link'> {
	return {
		link: function (this: RendererThis, { href, tokens }: Tokens.Link): string | false {
			const commandId = getCommandLinkId(href);
			if (commandId == null || allowedCommands?.has(commandId)) return false;

			return this.parser.parseInline(tokens);
		},
	};
}

/** A raw HTML block or tag trusted markdown may keep: a single `<span …>` open tag (for styling) or a `</span>`
 *  close tag, and nothing else — a block that merely starts or ends with one is dropped like any other HTML. */
const allowedRawHtmlRegex = /^(?:<span\s[^<>]*>|<\/\s*span\s*>)\s*$/;

export function isAllowedRawHtml(text: string): boolean {
	return allowedRawHtmlRegex.test(text);
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
