import { hrtime } from '@env/hrtime';
import type {
	WidthOptions as StringWidthOptions,
	TruncationOptions as StringWidthTruncationOptions,
	Result as TruncatedStringWidthResult,
} from '@gk-nzaytsev/fast-string-truncated-width';
import getTruncatedStringWidth from '@gk-nzaytsev/fast-string-truncated-width';
import { CharCode } from '../constants';
import { getNumericFormat } from './date';

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

export function getPossessiveForm(name: string) {
	return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

const defaultTruncationOptions: StringWidthTruncationOptions = {
	ellipsisWidth: 0,
	limit: 2 ** 30 - 1, // Max number that can be stored in V8's smis (small integers)
};

const defaultWidthOptions: StringWidthOptions = {
	ansiWidth: 0,
	controlWidth: 0,
	ambiguousWidth: 1,
	emojiWidth: 2,
	fullWidthWidth: 2,
	regularWidth: 1,
	wideWidth: 2,
};

export function getTruncatedWidth(s: string, limit: number, ellipsisWidth: number): TruncatedStringWidthResult {
	if (s == null || s.length === 0) {
		return {
			truncated: false,
			ellipsed: false,
			width: 0,
			index: 0,
		};
	}

	return getTruncatedStringWidth(s, { limit: limit, ellipsisWidth: ellipsisWidth ?? 0 }, defaultWidthOptions);
}

export function getWidth(s: string): number {
	if (s == null || s.length === 0) return 0;

	const result = getTruncatedStringWidth(s, defaultTruncationOptions, defaultWidthOptions);
	return result.width;
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

		// eslint-disable-next-line @typescript-eslint/restrict-plus-operands
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

export function padOrTruncateEnd(s: string, maxLength: number, fillString?: string) {
	if (s.length === maxLength) return s;
	if (s.length > maxLength) return s.substring(0, maxLength);
	return s.padEnd(maxLength, fillString);
}

let numericFormat: ReturnType<typeof getNumericFormat> | undefined;

export function pluralize(
	s: string,
	count: number,
	options?: {
		/** Controls the character/string between the count and the string */
		infix?: string;
		/** Formats the count */
		format?: false | ((count: number) => string | undefined);
		/** Controls if only the string should be included */
		only?: boolean;
		/** Controls the plural version of the string */
		plural?: string;
		/** Controls the string for a zero value */
		zero?: string;
	},
) {
	if (options == null) {
		numericFormat ??= getNumericFormat();
		return `${numericFormat(count)} ${s}${count === 1 ? '' : 's'}`;
	}

	const suffix = count === 1 ? s : options.plural ?? `${s}s`;
	if (options.only) return suffix;

	let result;
	if (count === 0) {
		result = options.zero ?? count;
	} else if (options.format === false) {
		result = count;
	} else if (options.format != null) {
		result = options.format(count);
	} else {
		numericFormat ??= getNumericFormat();
		result = numericFormat(count);
	}

	return `${result}${options.infix ?? ' '}${suffix}`;
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

	return [s.substring(index), s.substring(0, index - 1)];
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

// Below adapted from https://github.com/pieroxy/lz-string

// Pre-computed from:
// const base64ReverseMap = new Uint8Array(123);
// const base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
// for (let i = 0; i < base64Chars.length; i++) {
// 	base64ReverseMap[base64Chars.charCodeAt(i)] = i;
// }

const base64ReverseMap = new Uint8Array([
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 62, 0, 0, 0, 63, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 0, 0, 0, 64, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7,
	8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 0, 0, 0, 0, 0, 0, 26, 27, 28, 29, 30, 31, 32,
	33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,
]);

export function decompressFromBase64LZString(input: string | undefined) {
	if (input == null || input === '') return '';

	const result = _decompressLZString(input, 32) ?? '';
	return result;
}

function _decompressLZString(input: string, resetValue: number) {
	const dictionary = new Array<string>(4096);
	dictionary[0] = '0';
	dictionary[1] = '1';
	dictionary[2] = '2';

	const result: string[] = [];
	const length = input.length;

	let val = base64ReverseMap[input.charCodeAt(0)];
	let position = resetValue;
	let index = 1;

	function readBits(maxpower: number): number {
		let bits = 0;
		let power = 1;
		do {
			bits |= Number((val & position) > 0) * power;
			power <<= 1;

			position >>= 1;
			if (position === 0) {
				position = resetValue;
				val = base64ReverseMap[input.charCodeAt(index++)];
			}
		} while (power !== maxpower);

		return bits;
	}

	let c = readBits(4);

	switch (c) {
		case 0:
			c = readBits(256);
			break;
		case 1:
			c = readBits(65536);
			break;
		case 2:
			return '';
	}

	let w = String.fromCharCode(c);
	dictionary[3] = w;
	result.push(w);

	let dictSize = 4;
	let enlargeIn = 4;
	let numBits = 3;

	while (index <= length) {
		c = readBits(1 << numBits);

		switch (c) {
			case 0:
				c = readBits(256);
				dictionary[dictSize] = String.fromCharCode(c);
				c = dictSize++;
				enlargeIn--;
				break;
			case 1:
				c = readBits(65536);
				dictionary[dictSize] = String.fromCharCode(c);
				c = dictSize++;
				enlargeIn--;
				break;
			case 2:
				return result.join('');
		}

		if (enlargeIn === 0) {
			enlargeIn = 1 << numBits++;
		}

		let entry = dictionary[c];
		if (entry === undefined) {
			if (c !== dictSize) return undefined;

			entry = w + w[0];
		}

		result.push(entry);
		dictionary[dictSize++] = w + entry[0];
		enlargeIn--;
		w = entry;

		if (enlargeIn === 0) {
			enlargeIn = 1 << numBits++;
		}
	}

	return undefined;
}
