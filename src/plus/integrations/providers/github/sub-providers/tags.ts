import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../../container.js';
import type { GitCache } from '../../../../../git/cache.js';
import type { GitTagsSubProvider, PagedResult, PagingOptions } from '../../../../../git/gitProvider.js';
import { GitTag } from '../../../../../git/models/tag.js';
import type { TagSortOptions } from '../../../../../git/utils/-webview/sorting.js';
import { sortTags } from '../../../../../git/utils/-webview/sorting.js';
import { debug } from '../../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../../system/logger.scope.js';
import { toTokenWithInfo } from '../../../authentication/models.js';
import type { GitHubGitProviderInternal } from '../githubGitProvider.js';
import { stripOrigin } from '../githubGitProvider.js';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class TagsGitSubProvider implements GitTagsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly cache: GitCache,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@debug()
	async getTag(repoPath: string, name: string, cancellation?: CancellationToken): Promise<GitTag | undefined> {
		const {
			values: [tag],
		} = await this.getTags(repoPath, { filter: t => t.name === name }, cancellation);
		return tag;
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async getTags(
		repoPath: string | undefined,
		options?: {
			filter?: (t: GitTag) => boolean;
			paging?: PagingOptions;
			sort?: boolean | TagSortOptions;
		},
		_cancellation?: CancellationToken,
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getScopedLogger();

		const tagsPromise = options?.paging?.cursor
			? undefined
			: this.cache.tags.getOrCreate(repoPath, async cancellable => {
					try {
						const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

						const tags: GitTag[] = [];

						let cursor = options?.paging?.cursor;
						const loadAll = cursor == null;

						let authoredDate;
						let committedDate;

						while (true) {
							const result = await github.getTags(
								toTokenWithInfo(this.provider.authenticationProviderId, session),
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
										this.container,
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
				});

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
		_cancellation?: CancellationToken,
	): Promise<string[]> {
		if (repoPath == null || options?.commitDate == null) return [];

		const scope = getScopedLogger();

		try {
			const { metadata, github, session } = await this.provider.ensureRepositoryContext(repoPath);

			const tags = await github.getTagsWithCommit(
				toTokenWithInfo(this.provider.authenticationProviderId, session),
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
