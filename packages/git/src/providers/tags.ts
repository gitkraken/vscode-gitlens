import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import type { GitTag } from '../models/tag.js';
import type { TagSortOptions } from '../utils/sorting.js';

export interface GitTagsSubProvider {
	getTag(repoPath: string, name: string, cancellation?: AbortSignal): Promise<GitTag | undefined>;
	getTags(
		repoPath: string,
		options?: {
			filter?: ((t: GitTag) => boolean) | undefined;
			paging?: PagingOptions | undefined;
			sort?: boolean | TagSortOptions | undefined;
		},
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitTag>>;
	getTagsWithCommit(
		repoPath: string,
		sha: string,
		options?: {
			commitDate?: Date | undefined;
			mode?: 'contains' | 'pointsAt' | undefined;
		},
		cancellation?: AbortSignal,
	): Promise<string[]>;

	createTag?(repoPath: string, name: string, sha: string, message?: string): Promise<void>;
	deleteTag?(repoPath: string, name: string): Promise<void>;
}
