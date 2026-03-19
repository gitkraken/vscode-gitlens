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

export function unescapeMarkdown(s: string): string {
	return (
		s
			// Unescape markdown
			.replace(unescapeMarkdownRegex, '$1')
			// Unescape markdown header
			.replace(unescapeMarkdownHeaderRegex, '===')
	);
}
