'use strict';
import { GitCommitType } from './commit';
import { Container } from '../../container';
import { GitFile } from './file';
import { GitLogCommit } from './logCommit';
import { GitReference } from './models';
import { gate, memoize } from '../../system';

const stashNumberRegex = /stash@{(\d+)}/;

export class GitStashCommit extends GitLogCommit {
	static isOfRefType(commit: GitReference | undefined) {
		return commit?.refType === 'stash';
	}

	static is(commit: any): commit is GitStashCommit {
		return (
			commit instanceof GitStashCommit
			// || (commit.repoPath !== undefined &&
			//     commit.sha !== undefined &&
			//     (commit.type === GitCommitType.Stash || commit.type === GitCommitType.StashFile))
		);
	}

	readonly refType = 'stash';

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

	private _untrackedFilesChecked = false;
	@gate()
	async checkForUntrackedFiles() {
		if (!this._untrackedFilesChecked) {
			this._untrackedFilesChecked = true;

			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			const commit = await Container.git.getCommit(this.repoPath, `${this.stashName}^3`);
			if (commit != null && commit.files.length !== 0) {
				// Since these files are untracked -- make them look that way
				commit.files.forEach(s => (s.status = '?'));

				this.files.push(...commit.files);
			}
		}
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
			changes.type ?? this.type,
			this.stashName,
			this.repoPath,
			this.getChangedValue(changes.sha, this.sha)!,
			changes.authorDate ?? this.authorDate,
			changes.committedDate ?? this.committerDate,
			changes.message ?? this.message,
			changes.fileName ?? this.fileName,
			this.getChangedValue(changes.files, this.files) ?? [],
		);
	}
}
