// NOTE@eamodio If this changes we need to update the replacement function too (since its parameter number/order relies on the matching)
const customDateTimeFormatParserRegex =
	/(?<literal>\[.*?\])|(?<year>YYYY|YY)|(?<month>M{1,4})|(?<day>Do|DD?)|(?<weekday>d{2,4})|(?<hour>HH?|hh?)|(?<minute>mm?)|(?<second>ss?)|(?<fractionalSecond>SSS)|(?<dayPeriod>A|a)|(?<timeZoneName>ZZ?)/g;
const dateTimeFormatRegex = /(?<dateStyle>full|long|medium|short)(?:\+(?<timeStyle>full|long|medium|short))?/;
const relativeUnitThresholds: [Intl.RelativeTimeFormatUnit, number, number, string][] = [
	['year', 24 * 60 * 60 * 1000 * (365 * 2 - 1), 24 * 60 * 60 * 1000 * 365, 'yr'],
	['month', (24 * 60 * 60 * 1000 * 365) / 12, (24 * 60 * 60 * 1000 * 365) / 12, 'mo'],
	['week', 24 * 60 * 60 * 1000 * 7, 24 * 60 * 60 * 1000 * 7, 'wk'],
	['day', 24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000, 'd'],
	['hour', 60 * 60 * 1000, 60 * 60 * 1000, 'h'],
	['minute', 60 * 1000, 60 * 1000, 'm'],
	['second', 1000, 1000, 's'],
];

type DateStyle = 'full' | 'long' | 'medium' | 'short';
type TimeStyle = 'full' | 'long' | 'medium' | 'short';
export type DateTimeFormat = DateStyle | `${DateStyle}+${TimeStyle}`;

let locale: string | undefined;
const dateTimeFormatCache = new Map<string | undefined, Intl.DateTimeFormat>();
let defaultLocales: string[] | undefined;
let defaultRelativeTimeFormat: InstanceType<typeof Intl.RelativeTimeFormat> | undefined;
let defaultShortRelativeTimeFormat: InstanceType<typeof Intl.RelativeTimeFormat> | undefined;

const numberFormatCache = new Map<string | undefined, Intl.NumberFormat>();

export function setDefaultDateLocales(locales: string | string[] | null | undefined) {
	if (typeof locales === 'string') {
		if (locales === 'system' || locales.trim().length === 0) {
			defaultLocales = undefined;
		} else {
			defaultLocales = [locales];
		}
	} else {
		defaultLocales = locales ?? undefined;
	}

	defaultRelativeTimeFormat = undefined;
	defaultShortRelativeTimeFormat = undefined;
	dateTimeFormatCache.clear();

	numberFormatCache.clear();

	locale = undefined;
}

export function createFromDateDelta(
	date: Date,
	delta: { years?: number; months?: number; days?: number; hours?: number; minutes?: number; seconds?: number },
): Date {
	const d = new Date(date.getTime());

	for (const [key, value] of Object.entries(delta)) {
		if (!value) continue;

		switch (key) {
			case 'years':
				d.setFullYear(d.getFullYear() + value);
				break;
			case 'months':
				d.setMonth(d.getMonth() + value);
				break;
			case 'days':
				d.setDate(d.getDate() + value);
				break;
			case 'hours':
				d.setHours(d.getHours() + value);
				break;
			case 'minutes':
				d.setMinutes(d.getMinutes() + value);
				break;
			case 'seconds':
				d.setSeconds(d.getSeconds() + value);
				break;
		}
	}

	return d;
}

export function fromNow(date: Date | number, short?: boolean): string {
	const elapsed = (typeof date === 'number' ? date : date.getTime()) - new Date().getTime();

	for (const [unit, threshold, divisor, shortUnit] of relativeUnitThresholds) {
		const elapsedABS = Math.abs(elapsed);
		if (elapsedABS >= threshold || threshold === 1000 /* second */) {
			if (short) {
				if (locale == null) {
					if (defaultShortRelativeTimeFormat != null) {
						locale = defaultShortRelativeTimeFormat.resolvedOptions().locale;
					} else if (defaultRelativeTimeFormat != null) {
						locale = defaultRelativeTimeFormat.resolvedOptions().locale;
					} else {
						defaultShortRelativeTimeFormat = new Intl.RelativeTimeFormat(defaultLocales, {
							localeMatcher: 'best fit',
							numeric: 'always',
							style: 'narrow',
						});
						locale = defaultShortRelativeTimeFormat.resolvedOptions().locale;
					}
				}

				if (locale === 'en' || locale?.startsWith('en-')) {
					const value = Math.round(elapsedABS / divisor);
					return `${value}${shortUnit}`;
				}

				if (defaultShortRelativeTimeFormat == null) {
					defaultShortRelativeTimeFormat = new Intl.RelativeTimeFormat(defaultLocales, {
						localeMatcher: 'best fit',
						numeric: 'always',
						style: 'narrow',
					});
				}

				return defaultShortRelativeTimeFormat.format(Math.round(elapsed / divisor), unit);
			}

			if (defaultRelativeTimeFormat == null) {
				defaultRelativeTimeFormat = new Intl.RelativeTimeFormat(defaultLocales, {
					localeMatcher: 'best fit',
					numeric: 'auto',
					style: 'long',
				});
			}
			return defaultRelativeTimeFormat.format(Math.round(elapsed / divisor), unit);
		}
	}

	return '';
}

export function formatDate(
	date: Date | number,
	format: 'full' | 'long' | 'medium' | 'short' | string | null | undefined,
	locale?: string,
	cache: boolean = true,
) {
	format = format ?? undefined;

	const key = `${locale ?? ''}:${format}`;

	let formatter = dateTimeFormatCache.get(key);
	if (formatter == null) {
		const options = getDateTimeFormatOptionsFromFormatString(format);

		let locales;
		if (locale == null) {
			locales = defaultLocales;
		} else if (locale === 'system') {
			locales = undefined;
		} else {
			locales = [locale];
		}

		formatter = new Intl.DateTimeFormat(locales, options);
		if (cache) {
			dateTimeFormatCache.set(key, formatter);
		}
	}

	if (format == null || dateTimeFormatRegex.test(format)) {
		return formatter.format(date);
	}

	function getTimeFormatter(format: TimeStyle) {
		const key = `${locale ?? ''}:time:${format}`;

		let formatter = dateTimeFormatCache.get(key);
		if (formatter == null) {
			const options: Intl.DateTimeFormatOptions = { localeMatcher: 'best fit', timeStyle: format };

			let locales;
			if (locale == null) {
				locales = defaultLocales;
			} else if (locale === 'system') {
				locales = undefined;
			} else {
				locales = [locale];
			}

			formatter = new Intl.DateTimeFormat(locales, options);
			if (cache) {
				dateTimeFormatCache.set(key, formatter);
			}
		}

		return formatter;
	}

	const parts = formatter.formatToParts(date);
	return format.replace(
		customDateTimeFormatParserRegex,
		(
			_match,
			literal,
			_year,
			_month,
			_day,
			_weekday,
			_hour,
			_minute,
			_second,
			_fractionalSecond,
			_dayPeriod,
			_timeZoneName,
			_offset,
			_s,
			groups,
		) => {
			if (literal != null) return (literal as string).substring(1, literal.length - 1);

			for (const [key, value] of Object.entries(groups)) {
				if (value == null) continue;

				const part = parts.find(p => p.type === key);

				if (value === 'Do' && part?.type === 'day') {
					return formatWithOrdinal(Number(part.value));
				} else if (value === 'a' && part?.type === 'dayPeriod') {
					// For some reason the Intl.DateTimeFormat doesn't honor the `dayPeriod` value and always returns the long version, so use the "short" timeStyle instead
					const dayPeriod = getTimeFormatter('short')
						.formatToParts(date)
						.find(p => p.type === 'dayPeriod');
					return ` ${(dayPeriod ?? part)?.value ?? ''}`;
				}
				return part?.value ?? '';
			}

			return '';
		},
	);
}

export function getDateDifference(
	first: Date | number,
	second: Date | number,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
	roundFn?: (value: number) => number,
): number {
	const diff =
		(typeof second === 'number' ? second : second.getTime()) -
		(typeof first === 'number' ? first : first.getTime());
	const round = roundFn ?? Math.floor;
	switch (unit) {
		case 'days':
			return round(diff / (1000 * 60 * 60 * 24));
		case 'hours':
			return round(diff / (1000 * 60 * 60));
		case 'minutes':
			return round(diff / (1000 * 60));
		case 'seconds':
			return round(diff / 1000);
		default:
			return diff;
	}
}

function getDateTimeFormatOptionsFromFormatString(
	format: DateTimeFormat | string | undefined,
): Intl.DateTimeFormatOptions {
	if (format == null) return { localeMatcher: 'best fit', dateStyle: 'full', timeStyle: 'short' };

	const match = dateTimeFormatRegex.exec(format);
	if (match?.groups != null) {
		const { dateStyle, timeStyle } = match.groups;
		return {
			localeMatcher: 'best fit',
			dateStyle: (dateStyle as Intl.DateTimeFormatOptions['dateStyle']) || 'full',
			timeStyle: (timeStyle as Intl.DateTimeFormatOptions['timeStyle']) || undefined,
		};
	}

	const options: Intl.DateTimeFormatOptions = { localeMatcher: 'best fit' };

	for (const { groups } of format.matchAll(customDateTimeFormatParserRegex)) {
		if (groups == null) continue;

		for (const [key, value] of Object.entries(groups)) {
			if (value == null) continue;

			switch (key) {
				case 'year':
					options.year = value.length === 4 ? 'numeric' : '2-digit';
					break;
				case 'month':
					switch (value.length) {
						case 4:
							options.month = 'long';
							break;
						case 3:
							options.month = 'short';
							break;
						case 2:
							options.month = '2-digit';
							break;
						case 1:
							options.month = 'numeric';
							break;
					}
					break;
				case 'day':
					if (value === 'DD') {
						options.day = '2-digit';
					} else {
						options.day = 'numeric';
					}
					break;
				case 'weekday':
					switch (value.length) {
						case 4:
							options.weekday = 'long';
							break;
						case 3:
							options.weekday = 'short';
							break;
						case 2:
							options.weekday = 'narrow';
							break;
					}
					break;
				case 'hour':
					options.hour = value.length === 2 ? '2-digit' : 'numeric';
					options.hour12 = value === 'hh' || value === 'h';
					break;
				case 'minute':
					options.minute = value.length === 2 ? '2-digit' : 'numeric';
					break;
				case 'second':
					options.second = value.length === 2 ? '2-digit' : 'numeric';
					break;
				case 'fractionalSecond':
					(options as any).fractionalSecondDigits = 3;
					break;
				case 'dayPeriod':
					options.dayPeriod = 'narrow';
					options.hour12 = true;
					options.hourCycle = 'h12';
					break;
				case 'timeZoneName':
					options.timeZoneName = value.length === 2 ? 'long' : 'short';
					break;
			}
		}
	}

	return options;
}

const ordinals = ['th', 'st', 'nd', 'rd'];
function formatWithOrdinal(n: number): string {
	const v = n % 100;
	return `${n}${ordinals[(v - 20) % 10] ?? ordinals[v] ?? ordinals[0]}`;
}

export function formatNumeric(
	value: number,
	style?: 'decimal' | 'currency' | 'percent' | 'unit' | null | undefined,
	locale?: string,
): string {
	const format = getNumericFormat(style, locale);
	return format(value);
}

export function getNumericFormat(
	style?: 'decimal' | 'currency' | 'percent' | 'unit' | null | undefined,
	locale?: string,
): Intl.NumberFormat['format'] {
	if (style == null) {
		style = 'decimal';
	}

	const key = `${locale ?? ''}:${style}`;

	let formatter = numberFormatCache.get(key);
	if (formatter == null) {
		const options: Intl.NumberFormatOptions = { localeMatcher: 'best fit', style: style };

		let locales;
		if (locale == null) {
			locales = defaultLocales;
		} else if (locale === 'system') {
			locales = undefined;
		} else {
			locales = [locale];
		}

		formatter = new Intl.NumberFormat(locales, options);
		numberFormatCache.set(key, formatter);
	}

	return formatter.format;
}
