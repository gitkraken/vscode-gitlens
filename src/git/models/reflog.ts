'use strict';
import { Dates, memoize } from '../../system';
import { CommitDateFormatting, Git } from '../git';
import { DateStyle } from '../../config';

export interface GitReflog {
	readonly repoPath: string;
	readonly records: GitReflogRecord[];

	readonly count: number;
	readonly maxCount: number | undefined;
	readonly truncated: boolean;
}

export class GitReflogRecord {
	private _previousSha: string | undefined;

	constructor(
		public readonly repoPath: string,
		public readonly sha: string,
		private _selector: string,
		public readonly date: Date,
		public readonly command: string,
		public readonly commandArgs: string | undefined,
		public readonly details: string | undefined
	) {}

	@memoize<GitReflogRecord['formatDate']>(format => (format == null ? 'MMMM Do, YYYY h:mma' : format))
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
		return CommitDateFormatting.dateStyle === DateStyle.Absolute
			? this.formatDate(CommitDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize()
	get HEAD() {
		if (this._selector == null || this._selector.length === 0) return '';

		if (this._selector.startsWith('refs/heads')) {
			return this._selector.substr(11);
		}

		if (this._selector.startsWith('refs/remotes')) {
			return this._selector.substr(13);
		}

		return this._selector;
	}

	get previousSha() {
		return this._previousSha;
	}

	@memoize()
	get previousShortSha() {
		return Git.shortenSha(this._previousSha);
	}

	get selector() {
		return this._selector;
	}

	@memoize()
	get shortSha() {
		return Git.shortenSha(this.sha);
	}

	update(previousSha?: string, selector?: string) {
		if (previousSha !== undefined) {
			this._previousSha = previousSha;
		}
		if (selector !== undefined) {
			this._selector = selector;
		}
	}

	@memoize()
	private get dateFormatter(): Dates.DateFormatter {
		return Dates.getFormatter(this.date);
	}
}
