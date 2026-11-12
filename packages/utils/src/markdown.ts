const escapeMarkdownRegex = /[\\*_{}[\]()#+\-.!<>]/g;
const unescapeMarkdownRegex = /\\([\\`*_{}[\]()#+\-.!<>])/g;
// Regex to find markdown links: [text](url) allowing for escaped brackets/parens within text/url
const markdownLinkRegex = /(\[((?:\\.|[^[\]\\])+)\]\(((?:\\.|[^()\\])+)\))/g;

const escapeMarkdownHeaderRegex = /^===/gm;
const unescapeMarkdownHeaderRegex = /^\u200b===/gm;

// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';
const markdownQuotedRegex = /\r?\n/g;
const markdownBacktickRegex = /`/g;

export function escapeMarkdown(
	s: string,
	options?: { quoted?: boolean; inlineBackticks?: boolean; preserveLinks?: boolean },
): string {
	// If preserving links, replace them with placeholders first
	if (options?.preserveLinks) {
		const links = new Map<string, string>();
		let linkIndex = 0;

		s = s.replace(markdownLinkRegex, match => {
			// Create a unique, unlikely-to-occur placeholder
			const placeholder = `$$$GLLINK${linkIndex++}GLLINK$$$`;
			links.set(placeholder, match);
			return placeholder;
		});

		// Escape markdown characters
		s = s.replace(escapeMarkdownRegex, '\\$&');

		// Restore the original links if they were preserved
		if (options?.preserveLinks && links.size) {
			for (const [placeholder, originalLink] of links) {
				s = s.replace(placeholder, originalLink);
			}
		}
	} else {
		// Escape markdown characters
		s = s.replace(escapeMarkdownRegex, '\\$&');
	}

	// Escape markdown header (since the above regex won't match it)
	s = s.replace(escapeMarkdownHeaderRegex, '\u200b===');

	if (options?.inlineBackticks) {
		s = escapeMarkdownCodeBlocks(s);
	} else {
		s = s.replace(markdownBacktickRegex, '\\$&');
	}

	if (!options?.quoted) return s;

	// Keep under the same block-quote but with line breaks
	return s.trim().replace(markdownQuotedRegex, '\t\\\n>  ');
}

/** escapes markdown code blocks */
export function escapeMarkdownCodeBlocks(s: string): string {
	const tripleBackticks = '```';
	const escapedTripleBackticks = '\\`\\`\\`';

	let result = '';
	let allowed = true;
	let quotesOpened = false;
	let buffer = '';

	for (let i = 0; i < s.length; i += 1) {
		const char = s[i];
		const chain = s.substring(i, i + 3);
		if (char === '\n' && quotesOpened) {
			allowed = false;
		}
		if (chain === tripleBackticks) {
			if (quotesOpened) {
				quotesOpened = false;
				if (allowed) {
					result += `${tripleBackticks}${buffer}${tripleBackticks}`;
				} else {
					result += `${escapedTripleBackticks}${buffer}${escapedTripleBackticks}`;
					allowed = true;
				}
				buffer = '';
			} else {
				quotesOpened = true;
			}
			// skip chain
			i += 2;
			continue;
		}

		if (quotesOpened) {
			buffer += char;
		} else {
			result += char;
		}
	}

	if (quotesOpened) {
		// Handle unclosed code block
		result += allowed ? tripleBackticks + buffer : escapedTripleBackticks + buffer;
	}

	return result;
}

// Matches the `](` of an inline link or the `]:` of a reference definition whose destination isn't a literal
// http(s)/mailto URL (the only whitespace skipped is what CommonMark allows before a destination, so anything
// unusual fails closed)
const defuseMarkdownLinksRegex = /\]([(:])(?![ \t\r\n]*(?:https?:\/\/|mailto:))/gi;

/**
 * Restricts links in externally-sourced Markdown text (e.g. commit messages) to web and mail destinations
 * (`http:`, `https:`, `mailto:`), leaving the visible text unchanged.
 *
 * Inline links (`[text](dest)`) and reference definitions (`[ref]: dest`) whose destination isn't a literal
 * http(s)/mailto URL are broken by inserting a zero-width space between the `]` and the `(`/`:` (CommonMark
 * requires them to be adjacent). Destinations that are obfuscated in any way (entity-encoded, escaped,
 * angle-bracketed) fail closed.
 *
 * Expects text that has already been HTML-encoded (see `encodeHtmlWeak`), which neutralizes raw HTML and
 * `<scheme:...>` autolinks, and must run before any trusted links are added to the text. Idempotent.
 */
export function defuseMarkdownLinks(s: string): string {
	if (!s.includes(']')) return s;

	return s.replace(defuseMarkdownLinksRegex, ']\u200b$1');
}

/** Escapes text for use inside a Markdown link title (`[text](url "title")`) */
export function escapeMarkdownLinkTitle(s: string): string {
	return s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

const webUrlRegex = /^https?:\/\//i;
const markdownLinkDestinationUnsafeRegex = /[\s()<>"\\]/g;

/**
 * Returns `url` ready to use as a Markdown link destination when it's a web (http/https) URL, otherwise `undefined`
 * so the caller renders its text unlinked. Characters that could end or escape the destination are percent-encoded;
 * the rest is left as is.
 */
export function getMarkdownWebLinkDestination(url: string | undefined): string | undefined {
	if (!url || !webUrlRegex.test(url)) return undefined;

	return url.replace(markdownLinkDestinationUnsafeRegex, c =>
		c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c),
	);
}

export function unescapeMarkdown(s: string): string {
	return (
		s
			// Unescape markdown
			.replace(unescapeMarkdownRegex, '$1')
			// Unescape markdown header
			.replace(unescapeMarkdownHeaderRegex, '===')
	);
}
