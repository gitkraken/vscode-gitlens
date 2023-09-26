import ansiRegex from 'ansi-regex';
import { hrtime } from '@env/hrtime';
import { CharCode } from '../constants';

export { fromBase64, base64 } from '@env/base64';

export function capitalize(s: string) {
	return `${s[0].toLocaleUpperCase()}${s.slice(1)}`;
}

let compareCollator: Intl.Collator | undefined;
export function compareIgnoreCase(a: string, b: string): 0 | -1 | 1 {
	if (compareCollator == null) {
		compareCollator = new Intl.Collator(undefined, { sensitivity: 'accent' });
	}

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

let sortCollator: Intl.Collator | undefined;
export function sortCompare(x: string, y: string): number {
	if (sortCollator == null) {
		sortCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	}
	return sortCollator.compare(x, y);
}

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

const tokenRegex = /\$\{(?:'(.*?[^\\])'|(\W*))?([^|]*?)(?:\|(\d+)(-|\?)?)?(?:'(.*?[^\\])'|(\W*))?\}/g;
const tokenSanitizeRegex = /\$\{(?:'.*?[^\\]'|\W*)?(\w*?)(?:'.*?[^\\]'|[\W\d]*)\}/g;
const tokenGroupCharacter = "'";
const tokenGroupCharacterEscapedRegex = /(\\')/g;

interface TokenMatch {
	key: string;
	start: number;
	end: number;
	options: TokenOptions;
}
const templateTokenMap = new Map<string, TokenMatch[]>();

export interface TokenOptions {
	collapseWhitespace: boolean;
	padDirection: 'left' | 'right';
	prefix: string | undefined;
	suffix: string | undefined;
	truncateTo: number | undefined;
}

function isWordChar(code: number): boolean {
	return (
		code === 95 /* _ */ ||
		(code >= 0x61 && code <= 0x7a) || // lowercase letters
		(code >= 0x41 && code <= 0x5a) || // uppercase letters
		(code >= 0x30 && code <= 0x39) // digits
	);
}

export function getTokensFromTemplate(template: string): TokenMatch[] {
	let tokens = templateTokenMap.get(template);
	if (tokens != null) return tokens;

	tokens = [];
	const length = template.length;

	let position = 0;
	while (position < length) {
		const tokenStart = template.indexOf('${', position);
		if (tokenStart === -1) break;

		const tokenEnd = template.indexOf('}', tokenStart);
		if (tokenEnd === -1) break;

		let tokenPos = tokenStart + 2;

		let key = '';
		let prefix = '';
		let truncateTo = '';
		let collapseWhitespace = false;
		let padDirection: 'left' | 'right' = 'right';
		let suffix = '';

		if (template[tokenPos] === "'") {
			const start = ++tokenPos;
			tokenPos = template.indexOf("'", tokenPos);
			if (tokenPos === -1) break;

			if (start !== tokenPos) {
				prefix = template.slice(start, tokenPos);
			}
			tokenPos++;
		} else if (!isWordChar(template.charCodeAt(tokenPos))) {
			const start = tokenPos++;
			while (tokenPos < tokenEnd && !isWordChar(template.charCodeAt(tokenPos))) {
				tokenPos++;
			}

			if (start !== tokenPos) {
				prefix = template.slice(start, tokenPos);
			}
		}

		while (tokenPos < tokenEnd) {
			let code = template.charCodeAt(tokenPos);
			if (isWordChar(code)) {
				key += template[tokenPos++];
			} else {
				if (code !== 0x7c /* | */) break;

				while (tokenPos < tokenEnd) {
					code = template.charCodeAt(++tokenPos);
					if (code >= 0x30 && code <= 0x39 /* digits */) {
						truncateTo += template[tokenPos];
						continue;
					}

					if (code === 0x3f /* ? */) {
						collapseWhitespace = true;
						tokenPos++;
					} else if (code === 0x2d /* - */) {
						padDirection = 'left';
						tokenPos++;
					}

					break;
				}
			}
		}

		if (tokenPos < tokenEnd) {
			if (template[tokenPos] === "'") {
				const start = ++tokenPos;
				tokenPos = template.indexOf("'", tokenPos);
				if (tokenPos === -1) break;

				if (start !== tokenPos) {
					suffix = template.slice(start, tokenPos);
				}
				tokenPos++;
			} else if (!isWordChar(template.charCodeAt(tokenPos))) {
				const start = tokenPos++;
				while (tokenPos < tokenEnd && !isWordChar(template.charCodeAt(tokenPos))) {
					tokenPos++;
				}

				if (start !== tokenPos) {
					suffix = template.slice(start, tokenPos);
				}
			}
		}

		position = tokenEnd + 1;
		tokens.push({
			key: key,
			start: tokenStart,
			end: position,
			options: {
				prefix: prefix || undefined,
				suffix: suffix || undefined,
				truncateTo: truncateTo ? parseInt(truncateTo, 10) : undefined,
				collapseWhitespace: collapseWhitespace,
				padDirection: padDirection,
			},
		});
	}

	templateTokenMap.set(template, tokens);
	return tokens;
}

// FYI, this is about twice as slow as getTokensFromTemplate
export function getTokensFromTemplateRegex(template: string): TokenMatch[] {
	let tokens = templateTokenMap.get(template);
	if (tokens != null) return tokens;

	tokens = [];

	let match;
	while ((match = tokenRegex.exec(template))) {
		const [, prefixGroup, prefixNonGroup, key, truncateTo, option, suffixGroup, suffixNonGroup] = match;
		const start = match.index;
		const end = start + match[0].length;

		let prefix = prefixGroup || prefixNonGroup || undefined;
		if (prefix) {
			prefix = prefix.replace(tokenGroupCharacterEscapedRegex, tokenGroupCharacter);
		}

		let suffix = suffixGroup || suffixNonGroup || undefined;
		if (suffix) {
			suffix = suffix.replace(tokenGroupCharacterEscapedRegex, tokenGroupCharacter);
		}

		tokens.push({
			key: key,
			start: start,
			end: end,
			options: {
				collapseWhitespace: option === '?',
				padDirection: option === '-' ? 'left' : 'right',
				prefix: prefix,
				suffix: suffix,
				truncateTo: truncateTo == null ? undefined : parseInt(truncateTo, 10),
			},
		});
	}

	templateTokenMap.set(template, tokens);
	return tokens;
}

export function interpolate(template: string, context: object | undefined): string {
	if (template == null || template.length === 0) return template;
	if (context == null) return template.replace(tokenSanitizeRegex, '');

	const tokens = getTokensFromTemplate(template);
	if (tokens.length === 0) return template;

	let position = 0;
	let result = '';
	for (const token of tokens) {
		result += template.slice(position, token.start) + ((context as Record<string, string>)[token.key] ?? '');
		position = token.end;
	}

	if (position < template.length) {
		result += template.slice(position);
	}

	return result;
}

export async function interpolateAsync(template: string, context: object | undefined): Promise<string> {
	if (template == null || template.length === 0) return template;
	if (context == null) return template.replace(tokenSanitizeRegex, '');

	const tokens = getTokensFromTemplate(template);
	if (tokens.length === 0) return template;

	let position = 0;
	let result = '';
	let value;
	for (const token of tokens) {
		value = (context as Record<string, any>)[token.key];
		if (value != null && typeof value === 'object' && typeof value.then === 'function') {
			value = await value;
		}

		result += template.slice(position, token.start) + (value ?? '');
		position = token.end;
	}

	if (position < template.length) {
		result += template.slice(position);
	}

	return result;
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

// Below adapted from https://github.com/pieroxy/lz-string

const keyStrBase64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const baseReverseDic: Record<string, Record<string, number>> = {};
function getBaseValue(alphabet: string, character: string | number) {
	if (!baseReverseDic[alphabet]) {
		baseReverseDic[alphabet] = {};
		for (let i = 0; i < alphabet.length; i++) {
			baseReverseDic[alphabet][alphabet.charAt(i)] = i;
		}
	}
	return baseReverseDic[alphabet][character];
}

export function decompressFromBase64LZString(input: string | undefined) {
	if (input == null || input === '') return '';
	return (
		_decompressLZString(input.length, 32, (index: number) => getBaseValue(keyStrBase64, input.charAt(index))) ?? ''
	);
}

function _decompressLZString(length: number, resetValue: any, getNextValue: (index: number) => number) {
	const dictionary = [];
	let next;
	let enlargeIn = 4;
	let dictSize = 4;
	let numBits = 3;
	let entry: any = '';
	const result = [];
	let i;
	let w: any;
	let bits;
	let resb;
	let maxpower;
	let power;
	let c;
	const data = { val: getNextValue(0), position: resetValue, index: 1 };

	for (i = 0; i < 3; i += 1) {
		dictionary[i] = i;
	}

	bits = 0;
	maxpower = Math.pow(2, 2);
	power = 1;
	while (power != maxpower) {
		resb = data.val & data.position;
		data.position >>= 1;
		if (data.position == 0) {
			data.position = resetValue;
			data.val = getNextValue(data.index++);
		}
		bits |= (resb > 0 ? 1 : 0) * power;
		power <<= 1;
	}

	const fromCharCode = String.fromCharCode;

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	switch ((next = bits)) {
		case 0:
			bits = 0;
			maxpower = Math.pow(2, 8);
			power = 1;
			while (power != maxpower) {
				resb = data.val & data.position;
				data.position >>= 1;
				if (data.position == 0) {
					data.position = resetValue;
					data.val = getNextValue(data.index++);
				}
				bits |= (resb > 0 ? 1 : 0) * power;
				power <<= 1;
			}
			c = fromCharCode(bits);
			break;
		case 1:
			bits = 0;
			maxpower = Math.pow(2, 16);
			power = 1;
			while (power != maxpower) {
				resb = data.val & data.position;
				data.position >>= 1;
				if (data.position == 0) {
					data.position = resetValue;
					data.val = getNextValue(data.index++);
				}
				bits |= (resb > 0 ? 1 : 0) * power;
				power <<= 1;
			}
			c = fromCharCode(bits);
			break;
		case 2:
			return '';
	}
	dictionary[3] = c;
	w = c;
	result.push(c);
	while (true) {
		if (data.index > length) {
			return '';
		}

		bits = 0;
		maxpower = Math.pow(2, numBits);
		power = 1;
		while (power != maxpower) {
			resb = data.val & data.position;
			data.position >>= 1;
			if (data.position == 0) {
				data.position = resetValue;
				data.val = getNextValue(data.index++);
			}
			bits |= (resb > 0 ? 1 : 0) * power;
			power <<= 1;
		}

		switch ((c = bits)) {
			case 0:
				bits = 0;
				maxpower = Math.pow(2, 8);
				power = 1;
				while (power != maxpower) {
					resb = data.val & data.position;
					data.position >>= 1;
					if (data.position == 0) {
						data.position = resetValue;
						data.val = getNextValue(data.index++);
					}
					bits |= (resb > 0 ? 1 : 0) * power;
					power <<= 1;
				}

				dictionary[dictSize++] = fromCharCode(bits);
				c = dictSize - 1;
				enlargeIn--;
				break;
			case 1:
				bits = 0;
				maxpower = Math.pow(2, 16);
				power = 1;
				while (power != maxpower) {
					resb = data.val & data.position;
					data.position >>= 1;
					if (data.position == 0) {
						data.position = resetValue;
						data.val = getNextValue(data.index++);
					}
					bits |= (resb > 0 ? 1 : 0) * power;
					power <<= 1;
				}
				dictionary[dictSize++] = fromCharCode(bits);
				c = dictSize - 1;
				enlargeIn--;
				break;
			case 2:
				return result.join('');
		}

		if (enlargeIn == 0) {
			enlargeIn = Math.pow(2, numBits);
			numBits++;
		}

		if (dictionary[c]) {
			entry = dictionary[c]!;
		} else if (c === dictSize) {
			entry = w + w.charAt(0);
		} else {
			return undefined;
		}
		result.push(entry);

		// Add w+entry[0] to the dictionary.

		dictionary[dictSize++] = w + entry.charAt(0);
		enlargeIn--;

		w = entry;

		if (enlargeIn == 0) {
			enlargeIn = Math.pow(2, numBits);
			numBits++;
		}
	}
}
