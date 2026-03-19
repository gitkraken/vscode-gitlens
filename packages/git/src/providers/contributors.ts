import type { GitContributor, GitContributorsStats } from '../models/contributor.js';

export interface GitContributorsResult {
	readonly contributors: GitContributor[];
	readonly cancelled?: { reason: 'cancelled' | 'timedout' } | undefined;
}

export interface GitContributorsSubProvider {
	getContributors(
		repoPath: string,
		rev?: string,
		options?: {
			all?: boolean;
			merges?: boolean | 'first-parent';
			pathspec?: string;
			since?: string;
			stats?: boolean;
		},
		cancellation?: AbortSignal,
		timeout?: number,
	): Promise<GitContributorsResult>;
	getContributorsLite(
		repoPath: string,
		rev?: string,
		options?: { all?: boolean; merges?: boolean | 'first-parent'; since?: string },
		cancellation?: AbortSignal,
	): Promise<GitContributor[]>;
	getContributorsStats(
		repoPath: string,
		options?: { merges?: boolean | 'first-parent'; since?: string },
		cancellation?: AbortSignal,
		timeout?: number,
	): Promise<GitContributorsStats | undefined>;
}
