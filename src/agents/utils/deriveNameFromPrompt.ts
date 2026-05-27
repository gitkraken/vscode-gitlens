const codeBlockRegex = /```[\s\S]*?```/g;
const fillerPrefixRegex =
	/^(?:please|can\s+you|could\s+you|would\s+you|i'?d\s+like\s+to|i\s+want\s+to|i\s+need\s+to|let'?s|help\s+me)\s+/i;
const meaningfulCharRegex = /[\p{L}\p{N}]/u;

const maxLength = 50;
const ellipsis = '…';

/**
 * Derives a short, human-readable session name from a user prompt. Strips code blocks,
 * trims common conversational filler, capitalizes, and truncates at a word boundary.
 * Returns `undefined` when the prompt yields nothing meaningful (empty, pure punctuation).
 */
export function deriveNameFromPrompt(prompt: string | undefined): string | undefined {
	if (!prompt) return undefined;

	let text = prompt.replace(codeBlockRegex, ' ');

	text =
		text
			.split(/\r?\n/)
			.map(line => line.trim())
			.find(line => line.length > 0) ?? '';
	if (!text) return undefined;

	let previous: string;
	do {
		previous = text;
		text = text.replace(fillerPrefixRegex, '');
	} while (text !== previous);

	text = text.replace(/\s+/g, ' ').trim();
	if (!text || !meaningfulCharRegex.test(text)) return undefined;

	text = text[0].toUpperCase() + text.slice(1);

	if (text.length <= maxLength) return text;

	const slice = text.slice(0, maxLength - 1);
	const lastSpace = slice.lastIndexOf(' ');
	const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
	return `${cut.trimEnd()}${ellipsis}`;
}
