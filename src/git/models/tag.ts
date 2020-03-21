'use strict';
import { Dates, memoize } from '../../system';
import { GitReference } from './models';
import { configuration, DateStyle, TagSorting } from '../../configuration';

export const TagDateFormatting = {
	dateFormat: undefined! as string | null,
	dateStyle: undefined! as DateStyle,

	reset: () => {
		TagDateFormatting.dateFormat = configuration.get('defaultDateFormat');
		TagDateFormatting.dateStyle = configuration.get('defaultDateStyle');
	},
};

export class GitTag implements GitReference {
	static is(tag: any): tag is GitTag {
		return tag instanceof GitTag;
	}

	static isOfRefType(tag: GitReference | undefined) {
		return tag !== undefined && tag.refType === 'tag';
	}

	static sort(tags: GitTag[]) {
		const order = configuration.get('sortTagsBy');

		switch (order) {
			case TagSorting.DateAsc:
				return tags.sort((a, b) => a.date.getTime() - b.date.getTime());
			case TagSorting.DateDesc:
				return tags.sort((a, b) => b.date.getTime() - a.date.getTime());
			case TagSorting.NameAsc:
				return tags.sort((a, b) =>
					b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }),
				);
			default:
				return tags.sort((a, b) =>
					a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
				);
		}
	}

	readonly refType = 'tag';

	constructor(
		public readonly repoPath: string,
		public readonly name: string,
		public readonly sha: string,
		public readonly message: string,
		public readonly date: Date,
		public readonly commitDate: Date | undefined,
	) {}

	get formattedDate(): string {
		return TagDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(TagDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	get ref() {
		return this.name;
	}

	@memoize()
	private get commitDateFormatter(): Dates.DateFormatter | undefined {
		return this.commitDate == null ? undefined : Dates.getFormatter(this.commitDate);
	}

	@memoize()
	private get dateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.date);
	}

	@memoize<GitTag['formatCommitDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
	formatCommitDate(format?: string | null) {
		const formatter = this.commitDateFormatter;
		if (formatter == null) return '';

		if (format == null) {
			format = 'MMMM Do, YYYY h:mma';
		}

		return formatter.format(format);
	}

	formatCommitDateFromNow() {
		const formatter = this.commitDateFormatter;
		if (formatter == null) return '';

		return formatter.fromNow();
	}

	@memoize<GitTag['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
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
	getBasename(): string {
		const index = this.name.lastIndexOf('/');
		return index !== -1 ? this.name.substring(index + 1) : this.name;
	}
}
