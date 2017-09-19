'use strict';
import { Strings } from '../../system';

export interface IFormatOptions {
    dateFormat?: string | null;
    tokenOptions?: { [id: string]: Strings.ITokenOptions | undefined };
}

type Constructor<T = {}> = new (...args: any[]) => T;

export abstract class Formatter<TItem = any, TOptions extends IFormatOptions = IFormatOptions> {

    protected _item: TItem;
    protected _options: TOptions;

    constructor(item: TItem, options?: TOptions) {
        this.reset(item, options);
    }

    reset(item: TItem, options?: TOptions) {
        this._item = item;

        if (options === undefined && this._options !== undefined) return;

        if (options === undefined) {
            options = {} as TOptions;
        }

        if (options.dateFormat == null) {
            options.dateFormat = 'MMMM Do, YYYY h:MMa';
        }

        if (options.tokenOptions == null) {
            options.tokenOptions = {};
        }

        this._options = options;
    }

    private collapsableWhitespace: number = 0;

    protected _padOrTruncate(s: string, options: Strings.ITokenOptions | undefined) {
        // NOTE: the collapsable whitespace logic relies on the javascript template evaluation to be left to right
        if (options === undefined) {
            options = {
                truncateTo: undefined,
                padDirection: 'left',
                collapseWhitespace: false
            };
        }

        let max = options.truncateTo;

        const width = Strings.width(s);
        if (max === undefined) {
            if (this.collapsableWhitespace === 0) return s;

            // If we have left over whitespace make sure it gets re-added
            const diff = this.collapsableWhitespace - width;
            this.collapsableWhitespace = 0;

            if (diff <= 0) return s;
            if (options.truncateTo === undefined) return s;
            return Strings.padLeft(s, diff);
        }

        max += this.collapsableWhitespace;
        this.collapsableWhitespace = 0;

        const diff = max - width;
        if (diff > 0) {
            if (options.collapseWhitespace) {
                this.collapsableWhitespace = diff;
            }

            if (options.padDirection === 'left') return Strings.padLeft(s, max);

            if (options.collapseWhitespace) {
                max -= diff;
            }
            return Strings.padRight(s, max);
        }

        if (diff < 0) return Strings.truncate(s, max);

        return s;
    }

    private static _formatter: Formatter | undefined = undefined;

    protected static fromTemplateCore<TFormatter extends Formatter<TItem, TOptions>, TItem, TOptions extends IFormatOptions>(formatter: TFormatter | Constructor<TFormatter>, template: string, item: TItem, dateFormatOrOptions?: string | null | TOptions): string {
        if (formatter instanceof Formatter) return Strings.interpolate(template, formatter);

        let options: TOptions | undefined = undefined;
        if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
            const tokenOptions = Strings.getTokensFromTemplate(template)
                .reduce((map, token) => {
                    map[token.key] = token.options;
                    return map;
                }, {} as { [token: string]: Strings.ITokenOptions | undefined });

            options = {
                dateFormat: dateFormatOrOptions,
                tokenOptions: tokenOptions
            } as TOptions;
        }
        else {
            options = dateFormatOrOptions;
        }

        if (this._formatter === undefined) {
            this._formatter = new formatter(item, options);
        }
        else {
            this._formatter.reset(item, options);
        }

        return Strings.interpolate(template, this._formatter);
    }
}