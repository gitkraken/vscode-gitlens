'use strict';
const _escapeRegExp = require('lodash.escaperegexp');
const stringWidth = require('string-width');

export namespace Strings {
    export function escapeRegExp(s: string): string {
        return _escapeRegExp(s);
    }

    export function getWidth(s: string): number {
        return stringWidth(s);
    }

    const TokenRegex = /\$\{([^|]*?)(?:\|(\d+)(\-|\?)?)?\}/g;
    const TokenSanitizeRegex = /\$\{(\w*?)(?:\W|\d)*?\}/g;

    export interface ITokenOptions {
        padDirection: 'left' | 'right';
        truncateTo: number | undefined;
        collapseWhitespace: boolean;
    }

    export function getTokensFromTemplate(template: string) {
        const tokens: { key: string, options: ITokenOptions }[] = [];

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

    export function interpolate(template: string, context: object): string {
        if (!template) return template;

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

    export function pad(s: string, before: number = 0, after: number = 0, padding: string = `\u00a0`) {
        if (before === 0 && after === 0) return s;

        return `${before === 0 ? '' : padding.repeat(before)}${s}${after === 0 ? '' : padding.repeat(after)}`;
    }

    export function padLeft(s: string, padTo: number, padding: string = '\u00a0') {
        const diff = padTo - getWidth(s);
        return (diff <= 0) ? s : '\u00a0'.repeat(diff) + s;
    }

    export function padLeftOrTruncate(s: string, max: number, padding?: string) {
        const len = getWidth(s);
        if (len < max) return padLeft(s, max, padding);
        if (len > max) return truncate(s, max);
        return s;
    }

    export function padRight(s: string, padTo: number, padding: string = '\u00a0') {
        const diff = padTo - getWidth(s);
        return (diff <= 0) ? s : s + '\u00a0'.repeat(diff);
    }

    export function padOrTruncate(s: string, max: number, padding?: string) {
        const left = max < 0;
        max = Math.abs(max);

        const len = getWidth(s);
        if (len < max) return left ? padLeft(s, max, padding) : padRight(s, max, padding);
        if (len > max) return truncate(s, max);
        return s;
    }

    export function padRightOrTruncate(s: string, max: number, padding?: string) {
        const len = getWidth(s);
        if (len < max) return padRight(s, max, padding);
        if (len > max) return truncate(s, max);
        return s;
    }

    // Removes \ / : * ? " < > | and C0 and C1 control codes
    const illegalCharsForFSRegEx = /[\\/:*?"<>|\x00-\x1f\x80-\x9f]/g;

    export function sanitizeForFS(s: string, replacement: string = '_') {
        if (!s) return s;
        return s.replace(illegalCharsForFSRegEx, replacement);
    }

    export function truncate(s: string, truncateTo: number, ellipsis: string = '\u2026') {
        if (!s) return s;

        const len = getWidth(s);
        if (len <= truncateTo) return s;
        if (len === s.length) return `${s.substring(0, truncateTo - 1)}${ellipsis}`;

        // Skip ahead to start as far as we can by assuming all the double-width characters won't be truncated
        let chars = Math.floor(truncateTo / (len / s.length));
        let count = getWidth(s.substring(0, chars));
        while (count < truncateTo) {
            count += getWidth(s[chars++]);
        }

        if (count >= truncateTo) {
            chars--;
        }

        return `${s.substring(0, chars)}${ellipsis}`;
    }
}