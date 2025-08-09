import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container';
import { isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import { TagError } from '../../../../git/errors';
import type { GitTagsSubProvider, PagedResult, PagingOptions } from '../../../../git/gitProvider';
import { GitTag } from '../../../../git/models/tag';
import { getTagParser } from '../../../../git/parsers/refParser';
import type { TagSortOptions } from '../../../../git/utils/-webview/sorting';
import { sortTags } from '../../../../git/utils/-webview/sorting';
import { filterMap } from '../../../../system/array';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import { maybeStopWatch } from '../../../../system/stopwatch';
import type { Git } from '../git';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class TagsGitSubProvider implements GitTagsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
	) {}

	@log()
	async getTag(repoPath: string, name: string, cancellation?: CancellationToken): Promise<GitTag | undefined> {
		const {
			values: [tag],
		} = await this.getTags(repoPath, { filter: t => t.name === name }, cancellation);
		return tag;
	}

	@log({ args: { 1: false } })
	async getTags(
		repoPath: string,
		options?: {
			filter?: (t: GitTag) => boolean;
			paging?: PagingOptions;
			sort?: boolean | TagSortOptions;
		},
		cancellation?: CancellationToken,
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getLogScope();

		const resultsPromise = this.cache.tags?.getOrCreate(repoPath, async cancellable => {
			try {
				const parser = getTagParser();

				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation },
					'for-each-ref',
					...parser.arguments,
					'refs/tags/',
				);
				if (!result.stdout) return emptyPagedResult;

				using sw = maybeStopWatch(scope, { log: false, logLevel: 'debug' });

				const tags: GitTag[] = [];

				for (const entry of parser.parse(result.stdout)) {
					tags.push(
						new GitTag(
							this.container,
							repoPath,
							entry.name,
							entry.sha || entry.tagSha,
							entry.message,
							entry.date ? new Date(entry.date) : undefined,
							entry.commitDate ? new Date(entry.commitDate) : undefined,
						),
					);
				}

				sw?.stop({ suffix: ` parsed ${tags.length} tags` });

				return { values: tags };
			} catch (ex) {
				cancellable.cancelled();
				Logger.error(ex, scope);
				if (isCancellationError(ex)) throw ex;

				return emptyPagedResult;
			}
		});

		if (resultsPromise == null) return emptyPagedResult;

		let result = await resultsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort) {
			sortTags(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@log()
	async getTagsWithCommit(
		repoPath: string,
		sha: string,
		options?: { commitDate?: Date; mode?: 'contains' | 'pointsAt' },
		cancellation?: CancellationToken,
	): Promise<string[]> {
		const result = await this.git.branchOrTag__containsOrPointsAt(
			repoPath,
			[sha],
			{ type: 'tag', ...options },
			cancellation,
		);
		if (!result.stdout) return [];

		return filterMap(result.stdout.split('\n'), b => b.trim() || undefined);
	}

	@log()
	async createTag(repoPath: string, name: string, sha: string, message?: string): Promise<void> {
		try {
			await this.git.tag(repoPath, name, sha, ...(message != null && message.length > 0 ? ['-m', message] : []));
		} catch (ex) {
			if (ex instanceof TagError) {
				throw ex.update({ tag: name, action: 'create' });
			}

			throw ex;
		}
	}

	@log()
	async deleteTag(repoPath: string, name: string): Promise<void> {
		try {
			await this.git.tag(repoPath, '-d', name);
		} catch (ex) {
			if (ex instanceof TagError) {
				throw ex.update({ tag: name, action: 'delete' });
			}

			throw ex;
		}
	}
}
