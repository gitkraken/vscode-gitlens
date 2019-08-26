'use strict';
import * as dayjs from 'dayjs';
import * as advancedFormat from 'dayjs/plugin/advancedFormat';
import * as relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(advancedFormat);
dayjs.extend(relativeTime);

export namespace Dates {
	export const MillisecondsPerMinute = 60000; // 60 * 1000
	export const MillisecondsPerHour = 3600000; // 60 * 60 * 1000
	export const MillisecondsPerDay = 86400000; // 24 * 60 * 60 * 1000

	export interface DateFormatter {
		fromNow(): string;
		format(format: string): string;
	}

	export function getFormatter(date: Date): DateFormatter {
		return dayjs(date);
	}
}
