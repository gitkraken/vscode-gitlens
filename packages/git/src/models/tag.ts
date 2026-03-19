import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import type { Shape } from '@gitlens/utils/types.js';
import { getTagId, parseRefName } from '../utils/tag.utils.js';
import type { GitTagReference } from './reference.js';

export type GitTagShape = Shape<GitTag>;

@loggable(i => i.id)
@serializable
export class GitTag implements GitTagReference {
	readonly refType = 'tag';
	readonly id: string;

	private readonly _name: string;
	get name(): string {
		return this._name;
	}

	constructor(
		public readonly repoPath: string,
		public readonly refName: string,
		public readonly sha: string,
		public readonly message: string,
		public readonly date: Date | undefined,
		public readonly commitDate: Date | undefined,
	) {
		({ name: this._name } = parseRefName(refName));

		this.id = getTagId(repoPath, this._name);
	}

	@memoize()
	get basename(): string {
		const index = this.name.lastIndexOf('/');
		return index !== -1 ? this.name.substring(index + 1) : this.name;
	}

	get ref(): string {
		return this.name;
	}

	/** Creates a copy of this tag with a different repoPath — ONLY used for worktree-aware caching */
	withRepoPath(repoPath: string): GitTag {
		if (repoPath === this.repoPath) return this;

		return new GitTag(repoPath, this.refName, this.sha, this.message, this.date, this.commitDate);
	}

	static is(tag: unknown): tag is GitTag {
		return tag instanceof GitTag;
	}

	static formatDate(tag: GitTagShape, format?: string | null): string {
		return tag.date != null ? formatDate(tag.date, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	static formatDateFromNow(tag: GitTagShape): string {
		return tag.date != null ? fromNow(tag.date) : '';
	}

	static formatCommitDate(tag: GitTagShape, format?: string | null): string {
		return tag.commitDate != null ? formatDate(tag.commitDate, format ?? 'MMMM Do, YYYY h:mma') : '';
	}

	static formatCommitDateFromNow(tag: GitTagShape): string {
		return tag.commitDate != null ? fromNow(tag.commitDate) : '';
	}
}
