'use strict';
import dayjs from 'dayjs';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(advancedFormat);
dayjs.extend(relativeTime);

export interface DateFormatter {
	fromNow(): string;
	format(format: string): string;
}

export function getDateFormatter(date: Date): DateFormatter {
	return dayjs(date);
}
