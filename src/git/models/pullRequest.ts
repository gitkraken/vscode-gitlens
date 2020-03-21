'use strict';
import { configuration, DateStyle } from '../../configuration';
import { Dates, memoize } from '../../system';

export const PullRequestDateFormatting = {
	dateFormat: undefined! as string | null,
	dateStyle: undefined! as DateStyle,

	reset: () => {
		PullRequestDateFormatting.dateFormat = configuration.get('defaultDateFormat');
		PullRequestDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	},
};

export enum PullRequestState {
	Open = 'Open',
	Closed = 'Closed',
	Merged = 'Merged',
}

export class PullRequest {
	static is(pr: any): pr is PullRequest {
		return pr instanceof PullRequest;
	}

	constructor(
		public readonly provider: string,
		public readonly number: number,
		public readonly title: string,
		public readonly url: string,
		public readonly state: PullRequestState,
		public readonly date: Date,
		public readonly closedDate?: Date,
		public readonly mergedDate?: Date,
	) {}

	get formattedDate(): string {
		return PullRequestDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(PullRequestDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize()
	private get dateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.mergedDate ?? this.closedDate ?? this.date);
	}

	@memoize<PullRequest['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.dateFormatter.format(format);
	}

	formatDateFromNow() {
		return this.dateFormatter.fromNow();
	}

	@memoize()
	private get closedDateFormatter(): Dates.DateFormatter | undefined {
		return this.closedDate === undefined ? undefined : Dates.getFormatter(this.closedDate);
	}

	@memoize<PullRequest['formatClosedDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatClosedDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.closedDateFormatter?.format(format) ?? '';
	}

	formatClosedDateFromNow() {
		return this.closedDateFormatter?.fromNow() ?? '';
	}

	@memoize()
	private get mergedDateFormatter(): Dates.DateFormatter | undefined {
		return this.mergedDate === undefined ? undefined : Dates.getFormatter(this.mergedDate);
	}

	@memoize<PullRequest['formatMergedDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatMergedDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.mergedDateFormatter?.format(format) ?? '';
	}

	formatMergedDateFromNow() {
		return this.mergedDateFormatter?.fromNow() ?? '';
	}

	@memoize()
	private get updatedDateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.date);
	}

	@memoize<PullRequest['formatUpdatedDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatUpdatedDate(format?: string | null) {
		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return this.updatedDateFormatter.format(format);
	}

	formatUpdatedDateFromNow() {
		return this.updatedDateFormatter.fromNow();
	}
}
