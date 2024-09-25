const escapeMarkdownRegex = /[\\*_{}[\]()#+\-.!]/g;
const unescapeMarkdownRegex = /\\([\\`*_{}[\]()#+\-.!])/g;

const escapeMarkdownHeaderRegex = /^===/gm;
const unescapeMarkdownHeaderRegex = /^\u200b===/gm;

// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';
const markdownQuotedRegex = /\r?\n/g;
const markdownBacktickRegex = /`/g;

export function escapeMarkdown(s: string, options: { quoted?: boolean; inlineBackticks?: boolean } = {}): string {
	s = s
		// Escape markdown
		.replace(escapeMarkdownRegex, '\\$&')
		// Escape markdown header (since the above regex won't match it)
		.replace(escapeMarkdownHeaderRegex, '\u200b===');

	if (options.inlineBackticks) {
		s = escapeMarkdownCodeBlocks(s);
	} else {
		s = s.replace(markdownBacktickRegex, '\\$&');
	}
	if (!options.quoted) return s;

	// Keep under the same block-quote but with line breaks
	return s.trim().replace(markdownQuotedRegex, '\t\\\n>  ');
}

/**
 * escapes markdown code blocks
 */
export function escapeMarkdownCodeBlocks(s: string) {
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
