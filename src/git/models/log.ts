import type { Range } from 'vscode';
import type { GitCommit } from './commit';

export interface GitLog {
	readonly repoPath: string;
	readonly commits: Map<string, GitCommit>;
	readonly count: number;

	readonly sha: string | undefined;
	readonly range: Range | undefined;

	readonly limit: number | undefined;
	readonly startingCursor?: string;
	readonly endingCursor?: string;
	readonly hasMore: boolean;

	readonly pagedCommits?: () => Map<string, GitCommit>;

	query?(limit: number | undefined): Promise<GitLog | undefined>;
	more?(limit: number | { until?: string } | undefined): Promise<GitLog | undefined>;
}
