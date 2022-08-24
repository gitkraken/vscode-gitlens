import type { Range } from 'vscode';
import type { GitCommit } from './commit';

export interface GitLog {
	readonly repoPath: string;
	readonly commits: Map<string, GitCommit>;

	readonly sha: string | undefined;
	readonly range: Range | undefined;

	readonly count: number;
	readonly limit: number | undefined;
	readonly hasMore: boolean;
	readonly cursor?: string;

	readonly pagedCommits?: () => Map<string, GitCommit>;
	readonly previousCursor?: string;

	readonly supportsTips?: boolean;

	query?(limit: number | undefined): Promise<GitLog | undefined>;
	more?(limit: number | { until?: string } | undefined): Promise<GitLog | undefined>;
}
