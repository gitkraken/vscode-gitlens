import type { TokenOptions } from '../../system/string';
import {
	getTokensFromTemplate,
	getWidth,
	interpolate,
	interpolateAsync,
	padLeft,
	padRight,
	truncate,
} from '../../system/string';

export interface FormatOptions {
	dateFormat?: string | null;
	tokenOptions?: Record<string, TokenOptions | undefined>;
}

type Constructor<T = Record<string, unknown>> = new (...args: any[]) => T;

const hasTokenRegexMap = new Map<string, RegExp>();
const spaceReplacementRegex = / /g;

export declare type RequiredTokenOptions<Options extends FormatOptions> = Options &
	Required<Pick<Options, 'tokenOptions'>>;

export abstract class Formatter<Item = any, Options extends FormatOptions = FormatOptions> {
	protected _item!: Item;
	protected _options!: RequiredTokenOptions<Options>;

	constructor(item: Item, options?: Options) {
		this.reset(item, options);
	}

	reset(item: Item, options?: Options) {
		this._item = item;
		this.collapsableWhitespace = 0;

		if (options == null && this._options != null) return;

		if (options == null) {
			options = {} as unknown as Options;
		}

		if (options.dateFormat == null) {
			options.dateFormat = 'MMMM Do, YYYY h:mma';
		}

		if (options.tokenOptions == null) {
			options.tokenOptions = {};
		}

		this._options = options as RequiredTokenOptions<Options>;
	}

	private collapsableWhitespace: number = 0;

	protected _padOrTruncate(s: string, options: TokenOptions | undefined) {
		if (s == null || s.length === 0) return s;

		// NOTE: the collapsable whitespace logic relies on the javascript template evaluation to be left to right
		if (options == null) {
			options = {
				collapseWhitespace: false,
				padDirection: 'left',
				prefix: undefined,
				suffix: undefined,
				truncateTo: undefined,
			};
		}

		let max = options.truncateTo;
		if (max == null) {
			this.collapsableWhitespace = 0;
		} else {
			max += this.collapsableWhitespace;
			this.collapsableWhitespace = 0;

			const width = getWidth(s);
			const diff = max - width;
			if (diff > 0) {
				if (options.collapseWhitespace) {
					this.collapsableWhitespace = diff;
				}

				if (options.padDirection === 'left') {
					s = padLeft(s, max, undefined, width);
				} else {
					if (options.collapseWhitespace) {
						max -= diff;
					}
					s = padRight(s, max, undefined, width);
				}
			} else if (diff < 0) {
				s = truncate(s, max, undefined, width);
			}
		}

		if (options.prefix || options.suffix) {
			s = `${options.prefix ?? ''}${s}${options.suffix ?? ''}`;
		}

		return s;
	}

	private static _formatter: Formatter | undefined = undefined;

	protected static fromTemplateCore<TFormatter extends Formatter<Item, Options>, Item, Options extends FormatOptions>(
		formatter: TFormatter | Constructor<TFormatter>,
		template: string,
		item: Item,
		dateFormatOrOptions?: string | null | Options,
	): string {
		// Preserve spaces
		template = template.replace(spaceReplacementRegex, '\u00a0');
		if (formatter instanceof Formatter) return interpolate(template, formatter);

		let options: Options | undefined = undefined;
		if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
			options = {
				dateFormat: dateFormatOrOptions,
			} as unknown as Options;
		} else {
			options = dateFormatOrOptions;
		}

		if (options.tokenOptions == null) {
			const tokenOptions = getTokensFromTemplate(template).reduce<{
				[token: string]: TokenOptions | undefined;
			}>((map, token) => {
				map[token.key] = token.options;
				return map;
			}, Object.create(null));

			options.tokenOptions = tokenOptions;
		}

		if (this._formatter == null) {
			this._formatter = new formatter(item, options);
		} else {
			this._formatter.reset(item, options);
		}

		return interpolate(template, this._formatter);
	}

	protected static fromTemplateCoreAsync<
		TFormatter extends Formatter<Item, Options>,
		Item,
		Options extends FormatOptions,
	>(
		formatter: TFormatter | Constructor<TFormatter>,
		template: string,
		item: Item,
		dateFormatOrOptions?: string | null | Options,
	): Promise<string> {
		// Preserve spaces
		template = template.replace(spaceReplacementRegex, '\u00a0');
		if (formatter instanceof Formatter) return interpolateAsync(template, formatter);

		let options: Options | undefined = undefined;
		if (dateFormatOrOptions == null || typeof dateFormatOrOptions === 'string') {
			options = {
				dateFormat: dateFormatOrOptions,
			} as unknown as Options;
		} else {
			options = dateFormatOrOptions;
		}

		if (options.tokenOptions == null) {
			const tokenOptions = getTokensFromTemplate(template).reduce<{
				[token: string]: TokenOptions | undefined;
			}>((map, token) => {
				map[token.key] = token.options;
				return map;
			}, Object.create(null));

			options.tokenOptions = tokenOptions;
		}

		if (this._formatter == null) {
			this._formatter = new formatter(item, options);
		} else {
			this._formatter.reset(item, options);
		}

		return interpolateAsync(template, this._formatter);
	}

	static has<TOptions extends FormatOptions>(
		template: string,
		...tokens: (keyof NonNullable<TOptions['tokenOptions']>)[]
	): boolean {
		const token =
			tokens.length === 1
				? (tokens[0] as string)
				: (`(${tokens.join('|')})` as keyof NonNullable<TOptions['tokenOptions']> as string);

		let regex = hasTokenRegexMap.get(token);
		if (regex == null) {
			regex = new RegExp(`\\b${token}\\b`);
			hasTokenRegexMap.set(token, regex);
		}

		return regex.test(template);
	}
}
