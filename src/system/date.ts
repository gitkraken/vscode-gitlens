'use strict';
import * as dayjs from 'dayjs';
import * as advancedFormat from 'dayjs/plugin/advancedFormat';
import * as relativeTime from 'dayjs/plugin/relativeTime';
import * as updateLocale from 'dayjs/plugin/updateLocale';

dayjs.extend(advancedFormat);
dayjs.extend(relativeTime);
dayjs.extend(relativeTime, {
	thresholds: [
		{ l: 's', r: 44, d: 'second' },
		{ l: 'm', r: 89 },
		{ l: 'mm', r: 44, d: 'minute' },
		{ l: 'h', r: 89 },
		{ l: 'hh', r: 21, d: 'hour' },
		{ l: 'd', r: 35 },
		{ l: 'dd', r: 6, d: 'day' },
		{ l: 'w', r: 7 },
		{ l: 'ww', r: 3, d: 'week' },
		{ l: 'M', r: 4 },
		{ l: 'MM', r: 10, d: 'month' },
		{ l: 'y', r: 17 },
		{ l: 'yy', d: 'year' },
	],
});
dayjs.extend(updateLocale);

dayjs.updateLocale('en', {
	relativeTime: {
		future: 'in %s',
		past: '%s ago',
		s: 'seconds',
		m: 'a minute',
		mm: '%d minutes',
		h: 'an hour',
		hh: '%d hours',
		d: 'a day',
		dd: '%d days',
		w: 'a week',
		ww: '%d weeks',
		M: 'a month',
		MM: '%d months',
		y: 'a year',
		yy: '%d years',
	},
});

const shortLocale = {
	name: 'en-short',
	weekdays: 'Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday'.split('_'),
	months: 'January_February_March_April_May_June_July_August_September_October_November_December'.split('_'),
	weekStart: 1,
	weekdaysShort: 'Sun_Mon_Tue_Wed_Thu_Fri_Sat'.split('_'),
	monthsShort: 'Jan_Feb_Mar_Apr_May_Jun_Jul_Aug_Sep_Oct_Nov_Dec'.split('_'),
	weekdaysMin: 'Su_Mo_Tu_We_Th_Fr_Sa'.split('_'),
	relativeTime: {
		future: 'in %s',
		past: '%s',
		s: 'now',
		m: '1m',
		mm: '%dm',
		h: '1h',
		hh: '%dh',
		d: '1d',
		dd: '%dd',
		w: '1w',
		ww: '%dw',
		M: '1mo',
		MM: '%dmo',
		y: '1yr',
		yy: '%dyr',
	},
	formats: {
		LTS: 'h:mm:ss A',
		LT: 'h:mm A',
		L: 'MM/DD/YYYY',
		LL: 'MMMM D, YYYY',
		LLL: 'MMMM D, YYYY h:mm A',
		LLLL: 'dddd, MMMM D, YYYY h:mm A',
	},
	ordinal: (n: number) => {
		const s = ['th', 'st', 'nd', 'rd'];
		const v = n % 100;
		return `[${n}${s[(v - 20) % 10] || s[v] || s[0]}]`;
	},
};

dayjs.locale('en-short', shortLocale, true);

export const MillisecondsPerMinute = 60000; // 60 * 1000
export const MillisecondsPerHour = 3600000; // 60 * 60 * 1000
export const MillisecondsPerDay = 86400000; // 24 * 60 * 60 * 1000

export interface DateFormatter {
	fromNow(locale?: string): string;
	format(format: string): string;
}

export function getFormatter(date: Date): DateFormatter {
	const formatter = dayjs(date);
	return {
		fromNow: function (locale?: string) {
			return (locale ? formatter.locale(locale) : formatter).fromNow();
		},
		format: function (format: string) {
			return formatter.format(format);
		},
	};
}
