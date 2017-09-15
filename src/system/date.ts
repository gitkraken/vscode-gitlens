'use strict';
import * as moment from 'moment';

const MillisecondsPerMinute = 60000; // 60 * 1000
const MillisecondsPerDay = 86400000; // 24 * 60 * 60 * 1000

export namespace Dates {

    export interface IDateFormatter {
        fromNow: () => string;
        format: (format: string) => string;
    }

    export function dateDaysFromNow(date: Date, now: number = Date.now()) {
        const startOfDayLeft = startOfDay(now);
        const startOfDayRight = startOfDay(date);

        const timestampLeft = startOfDayLeft.getTime() - startOfDayLeft.getTimezoneOffset() * MillisecondsPerMinute;
        const timestampRight = startOfDayRight.getTime() - startOfDayRight.getTimezoneOffset() * MillisecondsPerMinute;

        return Math.round((timestampLeft - timestampRight) / MillisecondsPerDay);
    }

    export function startOfDay(date: Date | number) {
        const newDate = new Date(typeof date === 'number' ? date : date.getTime());
        newDate.setHours(0, 0, 0, 0);
        return newDate;
    }

    export function toFormatter(date: Date): IDateFormatter {
        return moment(date);
    }
}