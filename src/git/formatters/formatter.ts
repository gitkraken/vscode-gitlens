import type { TokenOptions } from '../../system/string';
import { getTokensFromTemplate, getTruncatedWidth, getWidth, interpolate, interpolateAsync } from '../../system/string';

export interface FormatOptions {
	dateFormat?: string | null;
	tokenOptions?: Record<string, TokenOptions | undefined>;
}

type Constructor<T = Record<string, unknown>> = new (...args: any[]) => T;

const hasTokenRegexMap = new Map<string, RegExp>();
const spaceReplacementRegex = / /g;

export declare type RequiredTokenOptions<Options extends FormatOptions> = Options &
	Required<Pick<Options, 'tokenOptions'>>;

const defaultTokenOptions: Required<TokenOptions> = {
	collapseWhitespace: false,
	padDirection: 'left',
	prefix: undefined,
	suffix: undefined,
	truncateTo: undefined,
};

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
		options ??= defaultTokenOptions;

		// 0 is a special case to collapse to just the prefix and suffix
		if (options.truncateTo === 0) {
			return `${options.prefix ? options.prefix.trimEnd() : ''}${
				options.suffix ? options.suffix.trimStart() : ''
			}`;
		}

		if (options.prefix) {
			s = `${options.prefix}${s}`;
		}

		const suffixWidth = options.suffix ? getWidth(options.suffix) : 0;

		let max = options.truncateTo;
		if (max == null) {
			this.collapsableWhitespace = 0;
			return options.suffix ? `${s}${options.suffix}` : s;
		}

		max += this.collapsableWhitespace;
		this.collapsableWhitespace = 0;

		const r = getTruncatedWidth(s, max, suffixWidth + 1);
		if (r.truncated) return `${s.slice(0, r.index)}${r.ellipsed ? '\u2026' : ''}${options.suffix ?? ''}`;

		let width = r.width;
		if (options.suffix) {
			s += options.suffix;
			width += suffixWidth;
		}

		if (width === max) return s;

		if (options.collapseWhitespace) {
			this.collapsableWhitespace = max - width;
		}

		if (options.padDirection === 'left') {
			return s.padStart(max, '\u00a0');
		}

		if (options.collapseWhitespace) return s;

		return s.padEnd(max, '\u00a0');
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
			const tokenOptions = getTokensFromTemplate(template).reduce<Record<string, TokenOptions | undefined>>(
				(map, token) => {
					map[token.key] = token.options;
					return map;
				},
				Object.create(null),
			);

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
			const tokenOptions = getTokensFromTemplate(template).reduce<Record<string, TokenOptions | undefined>>(
				(map, token) => {
					map[token.key] = token.options;
					return map;
				},
				Object.create(null),
			);

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
