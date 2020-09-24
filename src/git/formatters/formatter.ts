'use strict';
import { Strings } from '../../system';

const emptyStr = '';

export interface FormatOptions {
	dateFormat?: string | null;
	tokenOptions?: Record<string, Strings.TokenOptions | undefined>;
}

type Constructor<T = Record<string, unknown>> = new (...args: any[]) => T;

const hasTokenRegexMap = new Map<string, RegExp>();
const spaceReplacementRegex = / /g;

declare type RequiredTokenOptions<TOptions extends FormatOptions> = TOptions & Required<Pick<TOptions, 'tokenOptions'>>;

export abstract class Formatter<TItem = any, TOptions extends FormatOptions = FormatOptions> {
	protected _item!: TItem;
	protected _options!: RequiredTokenOptions<TOptions>;

	constructor(item: TItem, options?: TOptions) {
		this.reset(item, options);
	}

	reset(item: TItem, options?: TOptions) {
		this._item = item;

		if (options === undefined && this._options !== undefined) return;

		if (options === undefined) {
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
			options = {} as TOptions;
		}

		if (options.dateFormat == null) {
			options.dateFormat = 'MMMM Do, YYYY h:mma';
		}

		if (options.tokenOptions == null) {
			options.tokenOptions = {};
		}

		this._options = options as RequiredTokenOptions<TOptions>;
	}

	private collapsableWhitespace: number = 0;

	protected _padOrTruncate(s: string, options: Strings.TokenOptions | undefined) {
		if (s == null || s.length === 0) return s;

		// NOTE: the collapsable whitespace logic relies on the javascript template evaluation to be left to right
		if (options === undefined) {
			options = {
				collapseWhitespace: false,
				padDirection: 'left',
				prefix: undefined,
				suffix: undefined,
				truncateTo: undefined,
			};
		}

		let max = options.truncateTo;
		if (max === undefined) {
			this.collapsableWhitespace = 0;
		} else {
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
				} else {
					if (options.collapseWhitespace) {
						max -= diff;
					}
					s = Strings.padRight(s, max, undefined, width);
				}
			} else if (diff < 0) {
				s = Strings.truncate(s, max, undefined, width);
			}
		}

		if (options.prefix || options.suffix) {
			s = `${options.prefix ?? emptyStr}${s}${options.suffix ?? emptyStr}`;
		}

		return s;
	}

	private static _formatter: Formatter | undefined = undefined;

	protected static fromTemplateCore<
		TFormatter extends Formatter<TItem, TOptions>,
		TItem,
		TOptions extends FormatOptions
	>(
		formatter: TFormatter | Constructor<TFormatter>,
		template: string,
		item: TItem,
		dateFormatOrOptions?: string | null | TOptions,
	): string {
		// Preserve spaces
		template = template.replace(spaceReplacementRegex, '\u00a0');
		if (formatter instanceof Formatter) return Strings.interpolate(template, formatter);

		let options: TOptions | undefined = undefined;
		if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
			// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
			options = {
				dateFormat: dateFormatOrOptions,
			} as TOptions;
		} else {
			options = dateFormatOrOptions;
		}

		if (options.tokenOptions == null) {
			const tokenOptions = Strings.getTokensFromTemplate(template).reduce<{
				[token: string]: Strings.TokenOptions | undefined;
			}>((map, token) => {
				map[token.key] = token.options;
				return map;
			}, Object.create(null));

			options.tokenOptions = tokenOptions;
		}

		if (this._formatter === undefined) {
			this._formatter = new formatter(item, options);
		} else {
			this._formatter.reset(item, options);
		}

		return Strings.interpolate(template, this._formatter);
	}

	static has<TOptions extends FormatOptions>(
		template: string,
		...tokens: (keyof NonNullable<TOptions['tokenOptions']>)[]
	): boolean {
		const token =
			tokens.length === 1
				? (tokens[0] as string)
				: ((`(${tokens.join('|')})` as keyof NonNullable<TOptions['tokenOptions']>) as string);

		let regex = hasTokenRegexMap.get(token);
		if (regex == null) {
			regex = new RegExp(`\\b${token}\\b`);
			hasTokenRegexMap.set(token, regex);
		}

		return regex.test(template);
	}
}
