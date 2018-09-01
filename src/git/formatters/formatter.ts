'use strict';
import { Strings } from '../../system';

export interface IFormatOptions {
    dateFormat?: string | null;
    tokenOptions?: { [id: string]: Strings.ITokenOptions | undefined };
}

type Constructor<T = {}> = new (...args: any[]) => T;

const spaceReplacementRegex = / /g;

export abstract class Formatter<TItem = any, TOptions extends IFormatOptions = IFormatOptions> {
    protected _item!: TItem;
    protected _options!: TOptions;

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
            options.dateFormat = 'MMMM Do, YYYY h:mma';
        }

        if (options.tokenOptions == null) {
            options.tokenOptions = {};
        }

        this._options = options;
    }

    private collapsableWhitespace: number = 0;

    protected _padOrTruncate(s: string, options: Strings.ITokenOptions | undefined) {
        if (s === '') return s;

        // NOTE: the collapsable whitespace logic relies on the javascript template evaluation to be left to right
        if (options === undefined) {
            options = {
                collapseWhitespace: false,
                padDirection: 'left',
                prefix: undefined,
                suffix: undefined,
                truncateTo: undefined
            };
        }

        let max = options.truncateTo;
        if (max === undefined) {
            if (this.collapsableWhitespace !== 0) {
                const width = Strings.getWidth(s);

                // If we have left over whitespace make sure it gets re-added
                const diff = this.collapsableWhitespace - width;
                this.collapsableWhitespace = 0;

                if (diff > 0 && options.truncateTo !== undefined) {
                    s = Strings.padLeft(s, diff, undefined, width);
                }
            }
        }
        else {
            max += this.collapsableWhitespace;
            this.collapsableWhitespace = 0;

            const width = Strings.getWidth(s);
            const diff = max - width;
            if (diff > 0) {
                if (options.collapseWhitespace) {
                    this.collapsableWhitespace = diff;
                }

                if (options.padDirection === 'left') {
                    s = Strings.padLeft(s, max, undefined, width);
                }
                else {
                    if (options.collapseWhitespace) {
                        max -= diff;
                    }
                    s = Strings.padRight(s, max, undefined, width);
                }
            }
            else if (diff < 0) {
                s = Strings.truncate(s, max, undefined, width);
            }
        }

        if (options.prefix || options.suffix) {
            s = `${options.prefix || ''}${s}${options.suffix || ''}`;
        }

        return s;
    }

    private static _formatter: Formatter | undefined = undefined;

    protected static fromTemplateCore<
        TFormatter extends Formatter<TItem, TOptions>,
        TItem,
        TOptions extends IFormatOptions
    >(
        formatter: TFormatter | Constructor<TFormatter>,
        template: string,
        item: TItem,
        dateFormatOrOptions?: string | null | TOptions
    ): string {
        // Preserve spaces
        template = template.replace(spaceReplacementRegex, '\u00a0');
        if (formatter instanceof Formatter) return Strings.interpolate(template, formatter);

        let options: TOptions | undefined = undefined;
        if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
            options = {
                dateFormat: dateFormatOrOptions
            } as TOptions;
        }
        else {
            options = dateFormatOrOptions;
        }

        if (options.tokenOptions == null) {
            const tokenOptions = Strings.getTokensFromTemplate(template).reduce(
                (map, token) => {
                    map[token.key] = token.options;
                    return map;
                },
                {} as { [token: string]: Strings.ITokenOptions | undefined }
            );

            options.tokenOptions = tokenOptions;
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
