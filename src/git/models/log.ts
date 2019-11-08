'use strict';
import { Range } from 'vscode';
import { GitAuthor } from './commit';
import { GitLogCommit } from './logCommit';

export interface GitLog {
	readonly repoPath: string;
	readonly authors: Map<string, GitAuthor>;
	readonly commits: Map<string, GitLogCommit>;

	readonly sha: string | undefined;
	readonly range: Range | undefined;

	readonly count: number;
	readonly limit: number | undefined;
	readonly hasMore: boolean;

	query?(limit: number | undefined): Promise<GitLog | undefined>;
	more?(limit: number | { until?: string } | undefined): Promise<GitLog | undefined>;
}
