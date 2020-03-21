'use strict';
import { GitCommitType } from './commit';
import { GitFile } from './file';
import { GitLogCommit } from './logCommit';
import { memoize } from '../../system';

const stashNumberRegex = /stash@{(\d+)}/;

export class GitStashCommit extends GitLogCommit {
	static is(commit: any): commit is GitStashCommit {
		return (
			commit instanceof GitStashCommit
			// || (commit.repoPath !== undefined &&
			//     commit.sha !== undefined &&
			//     (commit.type === GitCommitType.Stash || commit.type === GitCommitType.StashFile))
		);
	}

	constructor(
		type: GitCommitType,
		public readonly stashName: string,
		repoPath: string,
		sha: string,
		authorDate: Date,
		committedDate: Date,
		message: string,
		fileName: string,
		files: GitFile[],
	) {
		super(type, repoPath, sha, 'You', undefined, authorDate, committedDate, message, fileName, files);
	}

	@memoize()
	get number() {
		const match = stashNumberRegex.exec(this.stashName);
		if (match == null) return undefined;

		return match[1];
	}

	get shortSha() {
		return this.stashName;
	}

	with(changes: {
		type?: GitCommitType;
		sha?: string | null;
		fileName?: string;
		authorDate?: Date;
		committedDate?: Date;
		message?: string;
		files?: GitFile[] | null;
	}): GitLogCommit {
		return new GitStashCommit(
			changes.type || this.type,
			this.stashName,
			this.repoPath,
			this.getChangedValue(changes.sha, this.sha)!,
			changes.authorDate || this.authorDate,
			changes.committedDate || this.committerDate,
			changes.message || this.message,
			changes.fileName || this.fileName,
			this.getChangedValue(changes.files, this.files) || [],
		);
	}
}
