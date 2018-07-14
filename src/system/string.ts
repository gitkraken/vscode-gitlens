'use strict';
import { createHash, HexBase64Latin1Encoding } from 'crypto';

export namespace Strings {
    const pathNormalizer = /\\/g;
    const TokenRegex = /\$\{([^|]*?)(?:\|(\d+)(\-|\?)?)?\}/g;
    const TokenSanitizeRegex = /\$\{(\w*?)(?:\W|\d)*?\}/g;

    export interface ITokenOptions {
        padDirection: 'left' | 'right';
        truncateTo: number | undefined;
        collapseWhitespace: boolean;
    }

    export function getTokensFromTemplate(template: string) {
        const tokens: { key: string; options: ITokenOptions }[] = [];

        let match = TokenRegex.exec(template);
        while (match != null) {
            const truncateTo = match[2];
            const option = match[3];
            tokens.push({
                key: match[1],
                options: {
                    truncateTo: truncateTo == null ? undefined : parseInt(truncateTo, 10),
                    padDirection: option === '-' ? 'left' : 'right',
                    collapseWhitespace: option === '?'
                }
            });
            match = TokenRegex.exec(template);
        }

        return tokens;
    }

    export function interpolate(template: string, context: object | undefined): string {
        if (!template) return template;
        if (context === undefined) return template.replace(TokenSanitizeRegex, '');

        template = template.replace(TokenSanitizeRegex, '$${this.$1}');
        return new Function(`return \`${template}\`;`).call(context);
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
        return createHash('md5')
            .update(s)
            .digest(encoding);
    }

    export function normalizePath(fileName: string) {
        const normalized = fileName && fileName.replace(pathNormalizer, '/');
        // if (normalized && normalized.includes('..')) {
        //     debugger;
        // }
        return normalized;
    }

    export function pad(s: string, before: number = 0, after: number = 0, padding: string = `\u00a0`) {
        if (before === 0 && after === 0) return s;

        return `${before === 0 ? '' : padding.repeat(before)}${s}${after === 0 ? '' : padding.repeat(after)}`;
    }

    export function padLeft(s: string, padTo: number, padding: string = '\u00a0') {
        const diff = padTo - width(s);
        return diff <= 0 ? s : padding.repeat(diff) + s;
    }

    export function padLeftOrTruncate(s: string, max: number, padding?: string) {
        const len = width(s);
        if (len < max) return padLeft(s, max, padding);
        if (len > max) return truncate(s, max);
        return s;
    }

    export function padRight(s: string, padTo: number, padding: string = '\u00a0') {
        const diff = padTo - width(s);
        return diff <= 0 ? s : s + padding.repeat(diff);
    }

    export function padOrTruncate(s: string, max: number, padding?: string) {
        const left = max < 0;
        max = Math.abs(max);

        const len = width(s);
        if (len < max) return left ? padLeft(s, max, padding) : padRight(s, max, padding);
        if (len > max) return truncate(s, max);
        return s;
    }

    export function padRightOrTruncate(s: string, max: number, padding?: string) {
        const len = width(s);
        if (len < max) return padRight(s, max, padding);
        if (len > max) return truncate(s, max);
        return s;
    }

    // Removes \ / : * ? " < > | and C0 and C1 control codes
    const illegalCharsForFSRegEx = /[\\/:*?"<>|\x00-\x1f\x80-\x9f]/g;

    export function sanitizeForFileSystem(s: string, replacement: string = '_') {
        if (!s) return s;
        return s.replace(illegalCharsForFSRegEx, replacement);
    }

    export function sha1(s: string, encoding: HexBase64Latin1Encoding = 'base64'): string {
        return createHash('sha1')
            .update(s)
            .digest(encoding);
    }

    export function truncate(s: string, truncateTo: number, ellipsis: string = '\u2026') {
        if (!s) return s;

        const len = width(s);
        if (len <= truncateTo) return s;
        if (len === s.length) return `${s.substring(0, truncateTo - 1)}${ellipsis}`;

        // Skip ahead to start as far as we can by assuming all the double-width characters won't be truncated
        let chars = Math.floor(truncateTo / (len / s.length));
        let count = width(s.substring(0, chars));
        while (count < truncateTo) {
            count += width(s[chars++]);
        }

        if (count >= truncateTo) {
            chars--;
        }

        return `${s.substring(0, chars)}${ellipsis}`;
    }

    const ansiRegex = /[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[a-zA-Z\\d]*)*)?\\u0007)|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PRZcf-ntqry=><~]))/g;

    export function width(s: string): number {
        if (!s || s.length === 0) return 0;

        s = s.replace(ansiRegex, '');

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
                (0x2e80 <= cp && cp <= 0x3247 && cp !== 0x303f) ||
                // Enclosed CJK Letters and Months .. CJK Unified Ideographs Extension A
                (0x3250 <= cp && cp <= 0x4dbf) ||
                // CJK Unified Ideographs .. Yi Radicals
                (0x4e00 <= cp && cp <= 0xa4c6) ||
                // Hangul Jamo Extended-A
                (0xa960 <= cp && cp <= 0xa97c) ||
                // Hangul Syllables
                (0xac00 <= cp && cp <= 0xd7a3) ||
                // CJK Compatibility Ideographs
                (0xf900 <= cp && cp <= 0xfaff) ||
                // Vertical Forms
                (0xfe10 <= cp && cp <= 0xfe19) ||
                // CJK Compatibility Forms .. Small Form Variants
                (0xfe30 <= cp && cp <= 0xfe6b) ||
                // Halfwidth and Fullwidth Forms
                (0xff01 <= cp && cp <= 0xff60) ||
                (0xffe0 <= cp && cp <= 0xffe6) ||
                // Kana Supplement
                (0x1b000 <= cp && cp <= 0x1b001) ||
                // Enclosed Ideographic Supplement
                (0x1f200 <= cp && cp <= 0x1f251) ||
                // CJK Unified Ideographs Extension B .. Tertiary Ideographic Plane
                (0x20000 <= cp && cp <= 0x3fffd))
        ) {
            return true;
        }

        return false;
    }
}
