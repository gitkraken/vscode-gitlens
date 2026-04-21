import type { Cache } from '@gitlens/git/cache.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import type { GitTagsSubProvider } from '@gitlens/git/providers/tags.js';
import { stripOrigin } from '@gitlens/git/utils/revision.utils.js';
import type { TagSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortTags } from '@gitlens/git/utils/sorting.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult } from '@gitlens/utils/paging.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

export class TagsGitSubProvider implements GitTagsSubProvider {
	constructor(
		private readonly cache: Cache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	async getTag(repoPath: string, name: string, cancellation?: AbortSignal): Promise<GitTag | undefined> {
		const {
			values: [tag],
		} = await this.getTags(repoPath, { filter: t => t.name === name }, cancellation);
		return tag;
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getTags(
		repoPath: string | undefined,
		options?: { filter?: (t: GitTag) => boolean; paging?: PagingOptions; sort?: boolean | TagSortOptions },
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getScopedLogger();

		const tagsPromise = options?.paging?.cursor
			? undefined
			: this.cache.tags.getOrCreate(
					repoPath,
					async cancellable => {
						try {
							const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

							const tags: GitTag[] = [];

							let cursor = options?.paging?.cursor;
							const loadAll = cursor == null;

							let authoredDate;
							let committedDate;

							while (true) {
								const result = await github.getTags(
									toTokenInfo(this.provider.authenticationProviderId, session),
									metadata.repo.owner,
									metadata.repo.name,
									{ cursor: cursor },
								);

								for (const tag of result.values) {
									authoredDate =
										tag.target.authoredDate ??
										tag.target.target?.authoredDate ??
										tag.target.tagger?.date;
									committedDate =
										tag.target.committedDate ??
										tag.target.target?.committedDate ??
										tag.target.tagger?.date;

									tags.push(
										new GitTag(
											repoPath,
											tag.name,
											tag.target.target?.oid ?? tag.target.oid,
											tag.target.message ?? tag.target.target?.message ?? '',
											authoredDate != null ? new Date(authoredDate) : undefined,
											committedDate != null ? new Date(committedDate) : undefined,
										),
									);
								}

								if (!result.paging?.more || !loadAll) return { ...result, values: tags };

								cursor = result.paging.cursor;
							}
						} catch (ex) {
							cancellable.invalidate();
							scope?.error(ex);
							debugger;

							return emptyPagedResult;
						}
					},
					cancellation,
				);

		if (tagsPromise == null) {
			return emptyPagedResult;
		}

		let result = await tagsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort != null) {
			sortTags(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@debug()
	async getTagsWithCommit(
		repoPath: string,
		sha: string,
		options?: { commitDate?: Date; mode?: 'contains' | 'pointsAt' },
		_cancellation?: AbortSignal,
	): Promise<string[]> {
		if (repoPath == null || options?.commitDate == null) return [];

		const scope = getScopedLogger();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const tags = await github.getTagsWithCommit(
				toTokenInfo(this.provider.authenticationProviderId, session),
				metadata.repo.owner,
				metadata.repo.name,
				stripOrigin(sha),
				options?.commitDate,
			);

			return tags;
		} catch (ex) {
			scope?.error(ex);
			debugger;
			return [];
		}
	}
}
