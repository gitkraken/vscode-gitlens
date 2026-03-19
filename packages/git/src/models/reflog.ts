import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import type { Shape } from '@gitlens/utils/types.js';
import { shortenRevision } from '../utils/revision.utils.js';

export interface GitReflog {
	readonly repoPath: string;
	readonly records: GitReflogRecord[];

	readonly count: number;
	readonly total: number;
	readonly limit: number | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<GitReflog | undefined>;
}

export type GitReflogRecordShape = Shape<GitReflogRecord>;

@loggable(i => `${shortenRevision(i.sha)}|${i.command}`)
export class GitReflogRecord {
	private _previousSha: string | undefined;

	constructor(
		public readonly repoPath: string,
		public readonly sha: string,
		private _selector: string,
		public readonly date: Date,
		public readonly command: string,
		public readonly commandArgs: string | undefined,
		public readonly details: string | undefined,
	) {}

	@memoize()
	get HEAD(): string {
		if (this._selector == null || this._selector.length === 0) return '';

		if (this._selector.startsWith('refs/heads')) {
			return this._selector.substring(11);
		}

		if (this._selector.startsWith('refs/remotes')) {
			return this._selector.substring(13);
		}

		return this._selector;
	}

	get previousSha(): string | undefined {
		return this._previousSha;
	}

	@memoize()
	get previousShortSha(): string {
		return shortenRevision(this._previousSha);
	}

	get selector(): string {
		return this._selector;
	}

	@memoize()
	get shortSha(): string {
		return shortenRevision(this.sha);
	}

	/** @internal Called by the parser to set previousSha/selector before the record is published */
	update(previousSha?: string, selector?: string): void {
		if (previousSha !== undefined) {
			this._previousSha = previousSha;
		}
		if (selector !== undefined) {
			this._selector = selector;
		}
	}

	static is(record: unknown): record is GitReflogRecord {
		return record instanceof GitReflogRecord;
	}

	static formatDate(record: GitReflogRecordShape, format?: string | null): string {
		return formatDate(record.date, format ?? 'MMMM Do, YYYY h:mma');
	}

	static formatDateFromNow(record: GitReflogRecordShape): string {
		return fromNow(record.date);
	}
}
