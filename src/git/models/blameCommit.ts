'use strict';
import { GitCommit, GitCommitLine, GitCommitType } from './commit';

export class GitBlameCommit extends GitCommit {
	static is(commit: any): commit is GitBlameCommit {
		return (
			commit instanceof GitBlameCommit
			//|| (commit.repoPath !== undefined && commit.sha !== undefined && commit.type === GitCommitType.Blame)
		);
	}

	constructor(
		repoPath: string,
		sha: string,
		author: string,
		email: string | undefined,
		authorDate: Date,
		committerDate: Date,
		message: string,
		fileName: string,
		originalFileName: string | undefined,
		previousSha: string | undefined,
		previousFileName: string | undefined,
		public readonly lines: GitCommitLine[],
	) {
		super(
			GitCommitType.Blame,
			repoPath,
			sha,
			author,
			email,
			authorDate,
			committerDate,
			message,
			fileName,
			originalFileName,
			previousSha,
			previousFileName,
		);
	}

	with(changes: {
		sha?: string;
		fileName?: string;
		originalFileName?: string | null;
		previousFileName?: string | null;
		previousSha?: string | null;
		lines?: GitCommitLine[] | null;
	}): GitBlameCommit {
		return new GitBlameCommit(
			this.repoPath,
			changes.sha ?? this.sha,
			this.author,
			this.email,
			this.authorDate,
			this.committerDate,
			this.message,
			changes.fileName ?? this.fileName,
			this.getChangedValue(changes.originalFileName, this.originalFileName),
			this.getChangedValue(changes.previousSha, this.previousSha),
			this.getChangedValue(changes.previousFileName, this.previousFileName),
			this.getChangedValue(changes.lines, changes.sha ?? changes.fileName ? [] : this.lines) ?? [],
		);
	}
}
