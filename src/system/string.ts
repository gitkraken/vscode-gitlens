import ansiRegex from 'ansi-regex';
import { hrtime } from '@env/hrtime';
import { CharCode } from '../constants';

export { fromBase64, base64 } from '@env/base64';

const compareCollator = new Intl.Collator(undefined, { sensitivity: 'accent' });
export function compareIgnoreCase(a: string, b: string): 0 | -1 | 1 {
	const result = compareCollator.compare(a, b);
	// Intl.Collator.compare isn't guaranteed to always return 1 or -1 on all platforms so normalize it
	return result === 0 ? 0 : result > 0 ? 1 : -1;
}

export function equalsIgnoreCase(a: string | null | undefined, b: string | null | undefined): boolean {
	// Treat `null` & `undefined` as equivalent
	if (a == null && b == null) return true;
	if (a == null || b == null) return false;
	return compareIgnoreCase(a, b) === 0;
}

export const sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const sortCompare = sortCollator.compare;

export function compareSubstring(
	a: string,
	b: string,
	aStart: number = 0,
	aEnd: number = a.length,
	bStart: number = 0,
	bEnd: number = b.length,
): number {
	for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
		const codeA = a.charCodeAt(aStart);
		const codeB = b.charCodeAt(bStart);
		if (codeA < codeB) {
			return -1;
		} else if (codeA > codeB) {
			return 1;
		}
	}
	const aLen = aEnd - aStart;
	const bLen = bEnd - bStart;
	if (aLen < bLen) {
		return -1;
	} else if (aLen > bLen) {
		return 1;
	}
	return 0;
}

export function compareSubstringIgnoreCase(
	a: string,
	b: string,
	aStart: number = 0,
	aEnd: number = a.length,
	bStart: number = 0,
	bEnd: number = b.length,
): number {
	for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
		const codeA = a.charCodeAt(aStart);
		const codeB = b.charCodeAt(bStart);

		if (codeA === codeB) {
			// equal
			continue;
		}

		const diff = codeA - codeB;
		if (diff === 32 && isUpperAsciiLetter(codeB)) {
			//codeB =[65-90] && codeA =[97-122]
			continue;
		} else if (diff === -32 && isUpperAsciiLetter(codeA)) {
			//codeB =[97-122] && codeA =[65-90]
			continue;
		}

		if (isLowerAsciiLetter(codeA) && isLowerAsciiLetter(codeB)) {
			//
			return diff;
		}
		return compareSubstring(a.toLowerCase(), b.toLowerCase(), aStart, aEnd, bStart, bEnd);
	}

	const aLen = aEnd - aStart;
	const bLen = bEnd - bStart;

	if (aLen < bLen) {
		return -1;
	} else if (aLen > bLen) {
		return 1;
	}

	return 0;
}

export function encodeHtmlWeak(s: string): string;
export function encodeHtmlWeak(s: string | undefined): string | undefined;
export function encodeHtmlWeak(s: string | undefined): string | undefined {
	return s?.replace(/[<>&"]/g, c => {
		switch (c) {
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
			case '"':
				return '&quot;';
			default:
				return c;
		}
	});
}

const escapeMarkdownRegex = /[\\`*_{}[\]()#+\-.!]/g;
const escapeMarkdownHeaderRegex = /^===/gm;
// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';
const markdownQuotedRegex = /\r?\n/g;

export function escapeMarkdown(s: string, options: { quoted?: boolean } = {}): string {
	s = s
		// Escape markdown
		.replace(escapeMarkdownRegex, '\\$&')
		// Escape markdown header (since the above regex won't match it)
		.replace(escapeMarkdownHeaderRegex, '\u200b===');

	if (!options.quoted) return s;

	// Keep under the same block-quote but with line breaks
	return s.trim().replace(markdownQuotedRegex, '\t\\\n>  ');
}

export function escapeRegex(s: string) {
	return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

export function getDurationMilliseconds(start: [number, number]) {
	const [secs, nanosecs] = hrtime(start);
	return secs * 1000 + Math.floor(nanosecs / 1000000);
}

export function* getLines(data: string | string[], char: string = '\n'): IterableIterator<string> {
	if (typeof data === 'string') {
		let i = 0;
		while (i < data.length) {
			let j = data.indexOf(char, i);
			if (j === -1) {
				j = data.length;
			}

			yield data.substring(i, j);
			i = j + 1;
		}

		return;
	}

	let count = 0;
	let leftover: string | undefined;
	for (let s of data) {
		count++;
		if (leftover) {
			s = leftover + s;
			leftover = undefined;
		}

		let i = 0;
		while (i < s.length) {
			let j = s.indexOf(char, i);
			if (j === -1) {
				if (count === data.length) {
					j = s.length;
				} else {
					leftover = s.substring(i);
					break;
				}
			}

			yield s.substring(i, j);
			i = j + 1;
		}
	}
}

const superscripts = ['\u00B9', '\u00B2', '\u00B3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];

export function getSuperscript(num: number) {
	return superscripts[num - 1] ?? '';
}

const tokenRegex = /\$\{('.*?[^\\]'|\W*)?([^|]*?)(?:\|(\d+)(-|\?)?)?('.*?[^\\]'|\W*)?\}/g;
const tokenSanitizeRegex = /\$\{(?:'.*?[^\\]'|\W*)?(\w*?)(?:'.*?[^\\]'|[\W\d]*)\}/g;
const tokenGroupCharacter = "'";
const tokenGroupCharacterEscapedRegex = /(\\')/g;
const tokenGroupRegex = /^'?(.*?)'?$/s;

export interface TokenOptions {
	collapseWhitespace: boolean;
	padDirection: 'left' | 'right';
	prefix: string | undefined;
	suffix: string | undefined;
	truncateTo: number | undefined;
}

export function getTokensFromTemplate(template: string) {
	const tokens: { key: string; options: TokenOptions }[] = [];

	let match;
	do {
		match = tokenRegex.exec(template);
		if (match == null) break;

		let [, prefix, key, truncateTo, option, suffix] = match;
		// Check for a prefix group
		if (prefix != null) {
			match = tokenGroupRegex.exec(prefix);
			if (match != null) {
				[, prefix] = match;
				prefix = prefix.replace(tokenGroupCharacterEscapedRegex, tokenGroupCharacter);
			}
		}

		// Check for a suffix group
		if (suffix != null) {
			match = tokenGroupRegex.exec(suffix);
			if (match != null) {
				[, suffix] = match;
				suffix = suffix.replace(tokenGroupCharacterEscapedRegex, tokenGroupCharacter);
			}
		}

		tokens.push({
			key: key,
			options: {
				collapseWhitespace: option === '?',
				padDirection: option === '-' ? 'left' : 'right',
				prefix: prefix || undefined,
				suffix: suffix || undefined,
				truncateTo: truncateTo == null ? undefined : parseInt(truncateTo, 10),
			},
		});
	} while (true);

	return tokens;
}

const tokenSanitizeReplacement = `$\${$1=this.$1,($1 == null ? '' : $1)}`;
const interpolationMap = new Map<string, Function>();

export function interpolate(template: string, context: object | undefined): string {
	if (template == null || template.length === 0) return template;
	if (context == null) return template.replace(tokenSanitizeRegex, '');

	let fn = interpolationMap.get(template);
	if (fn == null) {
		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		fn = new Function(`return \`${template.replace(tokenSanitizeRegex, tokenSanitizeReplacement)}\`;`);
		interpolationMap.set(template, fn);
	}

	return fn.call(context) as string;
}

// eslint-disable-next-line prefer-arrow-callback
const AsyncFunction = Object.getPrototypeOf(async function () {
	/* noop */
}).constructor;

const tokenSanitizeReplacementAsync = `$\${$1=this.$1,($1 == null ? '' : typeof $1.then === 'function' ? (($1 = await $1),$1 == null ? '' : $1) : $1)}`;

const interpolationAsyncMap = new Map<string, typeof AsyncFunction>();

export async function interpolateAsync(template: string, context: object | undefined): Promise<string> {
	if (template == null || template.length === 0) return template;
	if (context == null) return template.replace(tokenSanitizeRegex, '');

	let fn = interpolationAsyncMap.get(template);
	if (fn == null) {
		// // eslint-disable-next-line @typescript-eslint/no-implied-eval
		const body = `return \`${template.replace(tokenSanitizeRegex, tokenSanitizeReplacementAsync)}\`;`;
		fn = new AsyncFunction(body);
		interpolationAsyncMap.set(template, fn);
	}

	const value = await fn.call(context);
	return value as string;
}

export function isLowerAsciiLetter(code: number): boolean {
	return code >= CharCode.a && code <= CharCode.z;
}

export function isUpperAsciiLetter(code: number): boolean {
	return code >= CharCode.A && code <= CharCode.Z;
}

export function pad(s: string, before: number = 0, after: number = 0, padding: string = '\u00a0') {
	if (before === 0 && after === 0) return s;

	return `${before === 0 ? '' : padding.repeat(before)}${s}${after === 0 ? '' : padding.repeat(after)}`;
}

export function padLeft(s: string, padTo: number, padding: string = '\u00a0', width?: number) {
	const diff = padTo - (width ?? getWidth(s));
	return diff <= 0 ? s : padding.repeat(diff) + s;
}

export function padLeftOrTruncate(s: string, max: number, padding?: string, width?: number) {
	width = width ?? getWidth(s);
	if (width < max) return padLeft(s, max, padding, width);
	if (width > max) return truncate(s, max, undefined, width);
	return s;
}

export function padRight(s: string, padTo: number, padding: string = '\u00a0', width?: number) {
	const diff = padTo - (width ?? getWidth(s));
	return diff <= 0 ? s : s + padding.repeat(diff);
}

export function padOrTruncate(s: string, max: number, padding?: string, width?: number) {
	const left = max < 0;
	max = Math.abs(max);

	width = width ?? getWidth(s);
	if (width < max) return left ? padLeft(s, max, padding, width) : padRight(s, max, padding, width);
	if (width > max) return truncate(s, max, undefined, width);
	return s;
}

export function padRightOrTruncate(s: string, max: number, padding?: string, width?: number) {
	width = width ?? getWidth(s);
	if (width < max) return padRight(s, max, padding, width);
	if (width > max) return truncate(s, max);
	return s;
}

export function pluralize(
	s: string,
	count: number,
	options?: {
		/** Controls the character/string between the count and the string */
		infix?: string;
		/** Formats the count */
		format?: (count: number) => string | undefined;
		/** Controls if only the string should be included */
		only?: boolean;
		/** Controls the plural version of the string */
		plural?: string;
		/** Controls the string for a zero value */
		zero?: string;
	},
) {
	if (options == null) return `${count} ${s}${count === 1 ? '' : 's'}`;

	const suffix = count === 1 ? s : options.plural ?? `${s}s`;
	if (options.only) return suffix;

	return `${count === 0 ? options.zero ?? count : options.format?.(count) ?? count}${options.infix ?? ' '}${suffix}`;
}

// Removes \ / : * ? " < > | and C0 and C1 control codes
// eslint-disable-next-line no-control-regex
const illegalCharsForFSRegex = /[\\/:*?"<>|\x00-\x1f\x80-\x9f]/g;

export function sanitizeForFileSystem(s: string, replacement: string = '_') {
	if (!s) return s;
	return s.replace(illegalCharsForFSRegex, replacement);
}

export function splitLast(s: string, splitter: string) {
	const index = s.lastIndexOf(splitter);
	if (index === -1) return [s];

	return [s.substr(index), s.substring(0, index - 1)];
}

export function splitSingle(s: string, splitter: string) {
	const index = s.indexOf(splitter);
	if (index === -1) return [s];

	const start = s.substring(0, index);
	const rest = s.substring(index + splitter.length);
	return rest != null ? [start, rest] : [start];
}

export function truncate(s: string, truncateTo: number, ellipsis: string = '\u2026', width?: number) {
	if (!s) return s;
	if (truncateTo <= 1) return ellipsis;

	width = width ?? getWidth(s);
	if (width <= truncateTo) return s;
	if (width === s.length) return `${s.substring(0, truncateTo - 1)}${ellipsis}`;

	// Skip ahead to start as far as we can by assuming all the double-width characters won't be truncated
	let chars = Math.floor(truncateTo / (width / s.length));
	let count = getWidth(s.substring(0, chars));
	while (count < truncateTo) {
		count += getWidth(s[chars++]);
	}

	if (count >= truncateTo) {
		chars--;
	}

	return `${s.substring(0, chars)}${ellipsis}`;
}

export function truncateLeft(s: string, truncateTo: number, ellipsis: string = '\u2026', width?: number) {
	if (!s) return s;
	if (truncateTo <= 1) return ellipsis;

	width = width ?? getWidth(s);
	if (width <= truncateTo) return s;
	if (width === s.length) return `${ellipsis}${s.substring(width - truncateTo)}`;

	// Skip ahead to start as far as we can by assuming all the double-width characters won't be truncated
	let chars = Math.floor(truncateTo / (width / s.length));
	let count = getWidth(s.substring(0, chars));
	while (count < truncateTo) {
		count += getWidth(s[chars++]);
	}

	if (count >= truncateTo) {
		chars--;
	}

	return `${ellipsis}${s.substring(s.length - chars)}`;
}

export function truncateMiddle(s: string, truncateTo: number, ellipsis: string = '\u2026') {
	if (!s) return s;
	if (truncateTo <= 1) return ellipsis;

	const width = getWidth(s);
	if (width <= truncateTo) return s;

	return `${s.slice(0, Math.floor(truncateTo / 2) - 1)}${ellipsis}${s.slice(width - Math.ceil(truncateTo / 2))}`;
}

let cachedAnsiRegex: RegExp | undefined;
const containsNonAsciiRegex = /[^\x20-\x7F\u00a0\u2026]/;

// See sindresorhus/string-width
export function getWidth(s: string): number {
	if (s == null || s.length === 0) return 0;

	// Shortcut to avoid needless string `RegExp`s, replacements, and allocations
	if (!containsNonAsciiRegex.test(s)) return s.length;

	if (cachedAnsiRegex == null) {
		cachedAnsiRegex = ansiRegex();
	}
	s = s.replace(cachedAnsiRegex, '');

	if (s.length === 0) return 0;

	let count = 0;
	let emoji = 0;
	let joiners = 0;

	const graphemes = [...s];
	for (let i = 0; i < graphemes.length; i++) {
		const code = graphemes[i].codePointAt(0)!;

		// Ignore control characters
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) continue;

		// Ignore combining characters
		if (code >= 0x300 && code <= 0x36f) continue;

		if (
			(code >= 0x1f600 && code <= 0x1f64f) || // Emoticons
			(code >= 0x1f300 && code <= 0x1f5ff) || // Misc Symbols and Pictographs
			(code >= 0x1f680 && code <= 0x1f6ff) || // Transport and Map
			(code >= 0x2600 && code <= 0x26ff) || // Misc symbols
			(code >= 0x2700 && code <= 0x27bf) || // Dingbats
			(code >= 0xfe00 && code <= 0xfe0f) || // Variation Selectors
			(code >= 0x1f900 && code <= 0x1f9ff) || // Supplemental Symbols and Pictographs
			(code >= 65024 && code <= 65039) || // Variation selector
			(code >= 8400 && code <= 8447) // Combining Diacritical Marks for Symbols
		) {
			if (code >= 0x1f3fb && code <= 0x1f3ff) continue; // emoji modifier fitzpatrick type

			emoji++;
			count += 2;
			continue;
		}

		// Ignore zero-width joiners '\u200d'
		if (code === 8205) {
			joiners++;
			count -= 2;
			continue;
		}

		// Surrogates
		if (code > 0xffff) {
			i++;
		}

		count += isFullwidthCodePoint(code) ? 2 : 1;
	}

	const offset = emoji - joiners;
	if (offset > 1) {
		count += offset - 1;
	}
	return count;
}

// See sindresorhus/is-fullwidth-code-point
function isFullwidthCodePoint(cp: number) {
	// code points are derived from:
	// http://www.unix.org/Public/UNIDATA/EastAsianWidth.txt
	if (
		cp >= 0x1100 &&
		(cp <= 0x115f || // Hangul Jamo
			cp === 0x2329 || // LEFT-POINTING ANGLE BRACKET
			cp === 0x232a || // RIGHT-POINTING ANGLE BRACKET
			// CJK Radicals Supplement .. Enclosed CJK Letters and Months
			(cp >= 0x2e80 && cp <= 0x3247 && cp !== 0x303f) ||
			// Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
			(cp >= 0x3250 && cp <= 0x4dbf) ||
			// CJK Unified Ideographs .. Yi Radicals
			(cp >= 0x4e00 && cp <= 0xa4c6) ||
			// Hangul Jamo Extended-A
			(cp >= 0xa960 && cp <= 0xa97c) ||
			// Hangul Syllables
			(cp >= 0xac00 && cp <= 0xd7a3) ||
			// CJK Compatibility Ideographs
			(cp >= 0xf900 && cp <= 0xfaff) ||
			// Vertical Forms
			(cp >= 0xfe10 && cp <= 0xfe19) ||
			// CJK Compatibility Forms .. Small Form Variants
			(cp >= 0xfe30 && cp <= 0xfe6b) ||
			// Halfwidth and Fullwidth Forms
			(cp >= 0xff01 && cp <= 0xff60) ||
			(cp >= 0xffe0 && cp <= 0xffe6) ||
			// Kana Supplement
			(cp >= 0x1b000 && cp <= 0x1b001) ||
			// Enclosed Ideographic Supplement
			(cp >= 0x1f200 && cp <= 0x1f251) ||
			// CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
			(cp >= 0x20000 && cp <= 0x3fffd))
	) {
		return true;
	}

	return false;
}
