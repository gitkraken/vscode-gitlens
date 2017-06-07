'use strict';
const _escapeRegExp = require('lodash.escaperegexp');

export namespace Strings {
    export function escapeRegExp(s: string): string {
        return _escapeRegExp(s);
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

    export function padLeft(s: string, padTo: number, padding: string = '\u00a0') {
        const diff = padTo - s.length;
        return (diff <= 0) ? s : '\u00a0'.repeat(diff) + s;
    }

    export function padLeftOrTruncate(s: string, max: number, padding?: string) {
        if (s.length < max) return padLeft(s, max, padding);
        if (s.length > max) return truncate(s, max);
        return s;
    }

    export function padRight(s: string, padTo: number, padding: string = '\u00a0') {
        const diff = padTo - s.length;
        return (diff <= 0) ? s : s + '\u00a0'.repeat(diff);
    }

    export function padOrTruncate(s: string, max: number, padding?: string) {
        const left = max < 0;
        max = Math.abs(max);

        if (s.length < max) return left ? padLeft(s, max, padding) : padRight(s, max, padding);
        if (s.length > max) return truncate(s, max);
        return s;
    }

    export function padRightOrTruncate(s: string, max: number, padding?: string) {
        if (s.length < max) return padRight(s, max, padding);
        if (s.length > max) return truncate(s, max);
        return s;
    }

    export function truncate(s: string, truncateTo?: number) {
        if (!s || truncateTo === undefined || s.length <= truncateTo) return s;
        return `${s.substring(0, truncateTo - 1)}\u2026`;
    }
}