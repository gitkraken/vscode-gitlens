'use strict';
import { createHash, HexBase64Latin1Encoding } from 'crypto';
import { isWindows } from '../git/shell';

const emptyStr = '';

export namespace Strings {
	export const enum CharCode {
		/**
		 * The `/` character.
		 */
		Slash = 47,
		/**
		 * The `\` character.
		 */
		Backslash = 92,
	}

	export function base64(s: string): string {
		const buffer = Buffer.from(s);
		return buffer.toString('base64');
	}

	const escapeMarkdownRegex = /[\\`*_{}[\]()#+\-.!]/g;
	const escapeMarkdownHeaderRegex = /^===/gm;
	// const sampleMarkdown = '## message `not code` *not important* _no underline_ \n> don\'t quote me \n- don\'t list me \n+ don\'t list me \n1. don\'t list me \nnot h1 \n=== \nnot h2 \n---\n***\n---\n___';
	const markdownQuotedRegex = /\n/g;

	export function escapeMarkdown(s: string, options: { quoted?: boolean } = {}): string {
		s = s
			// Escape markdown
			.replace(escapeMarkdownRegex, '\\$&')
			// Escape markdown header (since the above regex won't match it)
			.replace(escapeMarkdownHeaderRegex, '\u200b===');

		if (!options.quoted) return s;

		// Keep under the same block-quote but with line breaks
		return s.replace(markdownQuotedRegex, '\t\n>  ');
	}

	export function escapeRegex(s: string) {
		return s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
	}

	export function getCommonBase(s1: string, s2: string, delimiter: string) {
		let char;
		let index = 0;
		for (let i = 0; i < s1.length; i++) {
			char = s1[i];
			if (char !== s2[i]) break;

			if (char === delimiter) {
				index = i;
			}
		}

		return index > 0 ? s1.substring(0, index + 1) : undefined;
	}

	export function getDurationMilliseconds(start: [number, number]) {
		const [secs, nanosecs] = process.hrtime(start);
		return secs * 1000 + Math.floor(nanosecs / 1000000);
	}

	const superscripts = ['\u00B9', '\u00B2', '\u00B3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];

	export function getSuperscript(num: number) {
		return superscripts[num - 1] ?? '';
	}

	const driveLetterNormalizeRegex = /(?<=^\/?)([A-Z])(?=:\/)/;
	const pathNormalizeRegex = /\\/g;
	const pathStripTrailingSlashRegex = /\/$/g;
	const tokenRegex = /\$\{(".*?"|\W*)?([^|]*?)(?:\|(\d+)(-|\?)?)?(".*?"|\W*)?\}/g;
	const tokenSanitizeRegex = /\$\{(?:".*?"|\W*)?(\w*?)(?:".*?"|[\W\d]*)\}/g;
	// eslint-disable-next-line no-template-curly-in-string
	const tokenSanitizeReplacement = '$${this.$1}';

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

			const [, prefix, key, truncateTo, option, suffix] = match;
			tokens.push({
				key: key,
				options: {
					collapseWhitespace: option === '?',
					padDirection: option === '-' ? 'left' : 'right',
					prefix:
						prefix?.length > 1 && prefix?.startsWith('"') && prefix?.endsWith('"')
							? prefix.substr(1, prefix.length - 2)
							: prefix,
					suffix: suffix,
					truncateTo: truncateTo == null ? undefined : parseInt(truncateTo, 10),
				},
			});
		} while (true);

		return tokens;
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	const interpolationMap = new Map<string, Function>();

	export function interpolate(template: string, context: object | undefined): string {
		if (template == null || template.length === 0) return template;
		if (context == null) return template.replace(tokenSanitizeRegex, emptyStr);

		let fn = interpolationMap.get(template);
		if (fn == null) {
			// eslint-disable-next-line @typescript-eslint/no-implied-eval
			fn = new Function(`return \`${template.replace(tokenSanitizeRegex, tokenSanitizeReplacement)}\`;`);
			interpolationMap.set(template, fn);
		}

		return fn.call(context);
	}

	export function* lines(s: string): IterableIterator<string> {
		let i = 0;
		while (i < s.length) {
			let j = s.indexOf('\n', i);
			if (j === -1) {
				j = s.length;
			}

			yield s.substring(i, j);
			i = j + 1;
		}
	}

	export function md5(s: string, encoding: HexBase64Latin1Encoding = 'base64'): string {
		return createHash('md5').update(s).digest(encoding);
	}

	export function normalizePath(
		fileName: string,
		options: { addLeadingSlash?: boolean; stripTrailingSlash?: boolean } = { stripTrailingSlash: true },
	) {
		if (fileName == null || fileName.length === 0) return fileName;

		let normalized = fileName.replace(pathNormalizeRegex, '/');

		const { addLeadingSlash, stripTrailingSlash } = { stripTrailingSlash: true, ...options };

		if (stripTrailingSlash) {
			normalized = normalized.replace(pathStripTrailingSlashRegex, emptyStr);
		}

		if (addLeadingSlash && normalized.charCodeAt(0) !== CharCode.Slash) {
			normalized = `/${normalized}`;
		}

		if (isWindows) {
			// Ensure that drive casing is normalized (lower case)
			normalized = normalized.replace(driveLetterNormalizeRegex, (drive: string) => drive.toLowerCase());
		}

		return normalized;
	}

	export function pad(s: string, before: number = 0, after: number = 0, padding: string = '\u00a0') {
		if (before === 0 && after === 0) return s;

		return `${before === 0 ? emptyStr : padding.repeat(before)}${s}${
			after === 0 ? emptyStr : padding.repeat(after)
		}`;
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
		options?: { number?: string; plural?: string; suffix?: string; zero?: string },
	) {
		if (options == null) return `${count} ${s}${count === 1 ? emptyStr : 's'}`;

		return `${
			count === 0
				? options.zero != null
					? options.zero
					: count
				: options.number != null
				? options.number
				: count
		} ${count === 1 ? s : options.plural ?? `${s}${options.suffix ?? 's'}`}`;
	}

	// Removes \ / : * ? " < > | and C0 and C1 control codes
	// eslint-disable-next-line no-control-regex
	const illegalCharsForFSRegex = /[\\/:*?"<>|\x00-\x1f\x80-\x9f]/g;

	export function sanitizeForFileSystem(s: string, replacement: string = '_') {
		if (!s) return s;
		return s.replace(illegalCharsForFSRegex, replacement);
	}

	export function sha1(s: string, encoding: HexBase64Latin1Encoding = 'base64'): string {
		return createHash('sha1').update(s).digest(encoding);
	}

	export function splitLast(s: string, splitter: string) {
		const index = s.lastIndexOf(splitter);
		if (index === -1) return [s];

		return [s.substr(index), s.substring(0, index - 1)];
	}

	export function splitSingle(s: string, splitter: string) {
		const parts = s.split(splitter, 1);
		const first = parts[0];
		return first.length === s.length ? parts : [first, s.substr(first.length + 1)];
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

	// Lifted from https://github.com/chalk/ansi-regex
	// eslint-disable-next-line no-control-regex
	const ansiRegex = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~]))/g;
	const containsNonAsciiRegex = /[^\x20-\x7F\u00a0\u2026]/;

	export function getWidth(s: string): number {
		if (s == null || s.length === 0) return 0;

		// Shortcut to avoid needless string `RegExp`s, replacements, and allocations
		if (!containsNonAsciiRegex.test(s)) return s.length;

		s = s.replace(ansiRegex, emptyStr);

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

			// https://stackoverflow.com/questions/30757193/find-out-if-character-in-string-is-emoji
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
}
