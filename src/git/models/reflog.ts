'use strict';
import { Dates, memoize } from '../../system';
import { CommitFormatting } from '../git';
import { DateStyle } from '../../config';

export class GitReflog {
    previousRef: string | undefined;

    constructor(
        public readonly repoPath: string,
        public readonly ref: string,
        public readonly date: Date,
        public readonly command: string
    ) {}

    @memoize<GitReflog['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
    formatDate(format?: string | null) {
        if (format == null) {
            format = 'MMMM Do, YYYY h:mma';
        }

        return this.dateFormatter.format(format);
    }

    formatDateFromNow() {
        return this.dateFormatter.fromNow();
    }

    get formattedDate(): string {
        return CommitFormatting.dateStyle === DateStyle.Absolute
            ? this.formatDate(CommitFormatting.dateFormat)
            : this.formatDateFromNow();
    }

    @memoize()
    private get dateFormatter(): Dates.DateFormatter {
        return Dates.getFormatter(this.date);
    }
}
