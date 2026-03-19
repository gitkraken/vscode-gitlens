import type { GitRevisionRange } from '@gitlens/git/models/revision.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type {
	GitHubBlame,
	GitHubBranch,
	GitHubCommit,
	GitHubCommitFileStatus,
	GitHubCommitRef,
	GitHubContributor,
	GitHubPagedResult,
	GitHubTag,
} from '../models.js';
import type { GitHubTokenInfo } from './token.js';

/**
 * Comparison data from the GitHub REST API.
 * This is the response shape for `GET /repos/{owner}/{repo}/compare/{basehead}`.
 */
export interface GitHubComparison {
	status: 'ahead' | 'behind' | 'diverged' | 'identical';
	ahead_by: number;
	behind_by: number;
	total_commits: number;
	merge_base_commit?: { sha: string };
	files?: {
		filename: string;
		status: GitHubCommitFileStatus;
		additions: number;
		deletions: number;
		changes: number;
		previous_filename?: string;
	}[];
}

/**
 * Interface for GitHub API operations needed by Git sub-providers.
 * This is the subset of the full GitHubApi that the library needs —
 * only Git data methods, not PR/issue/integration methods.
 *
 * The extension bridges from its full `GitHubApi` class to this interface.
 */
export interface GitHubApiClient {
	getBlame(token: GitHubTokenInfo, owner: string, repo: string, ref: string, path: string): Promise<GitHubBlame>;

	getBranches(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubBranch>>;

	getBranchesWithCommits(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		refs: string[],
		mode: 'contains' | 'pointsAt',
		date?: Date,
	): Promise<string[]>;

	getBranchWithCommit(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		branch: string,
		refs: string[],
		mode: 'contains' | 'pointsAt',
		date?: Date,
	): Promise<string[]>;

	getCommit(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined>;

	getCommitForFile(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined>;

	getCommitCount(token: GitHubTokenInfo, owner: string, repo: string, ref: string): Promise<number | undefined>;

	getCommits(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			all?: boolean;
			authors?: GitUser[];
			before?: string;
			limit?: number;
			path?: string;
			since?: string | Date;
			until?: string | Date;
		},
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }>;

	getCommitRefs(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			before?: string;
			first?: number;
			last?: number;
			path?: string;
			since?: string;
			until?: string;
		},
	): Promise<GitHubPagedResult<GitHubCommitRef> | undefined>;

	getComparison(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		range: GitRevisionRange,
	): Promise<GitHubComparison | undefined>;

	getContributors(token: GitHubTokenInfo, owner: string, repo: string): Promise<GitHubContributor[]>;

	getCurrentUser(token: GitHubTokenInfo, owner: string, repo: string): Promise<GitUser | undefined>;

	getDefaultBranchName(token: GitHubTokenInfo, owner: string, repo: string): Promise<string | undefined>;

	getNextCommitRefs(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path: string,
		sha: string,
	): Promise<string[]>;

	getTags(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubTag>>;

	getTagsWithCommit(token: GitHubTokenInfo, owner: string, repo: string, ref: string, date: Date): Promise<string[]>;

	resolveReference(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path?: string,
	): Promise<string | undefined>;

	searchCommits(
		token: GitHubTokenInfo,
		query: string,
		options?: {
			cursor?: string;
			limit?: number;
			order?: 'asc' | 'desc' | undefined;
			sort?: 'author-date' | 'committer-date' | undefined;
		},
	): Promise<GitHubPagedResult<GitHubCommit> | undefined>;

	searchCommitShas(
		token: GitHubTokenInfo,
		query: string,
		options?: {
			cursor?: string;
			limit?: number;
			order?: 'asc' | 'desc' | undefined;
			sort?: 'author-date' | 'committer-date' | undefined;
		},
	): Promise<GitHubPagedResult<{ sha: string; authorDate: number; committerDate: number }> | undefined>;
}
