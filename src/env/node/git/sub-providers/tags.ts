import type { CancellationToken } from 'vscode';
import type { Container } from '../../../../container.js';
import { isCancellationError } from '../../../../errors.js';
import type { GitCache } from '../../../../git/cache.js';
import { TagError } from '../../../../git/errors.js';
import type { GitTagsSubProvider, PagedResult, PagingOptions } from '../../../../git/gitProvider.js';
import { GitTag } from '../../../../git/models/tag.js';
import { getTagParser } from '../../../../git/parsers/refParser.js';
import type { TagSortOptions } from '../../../../git/utils/-webview/sorting.js';
import { sortTags } from '../../../../git/utils/-webview/sorting.js';
import { filterMap } from '../../../../system/array.js';
import { debug } from '../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import { maybeStopWatch } from '../../../../system/stopwatch.js';
import type { Git } from '../git.js';
import { getGitCommandError } from '../git.js';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

export class TagsGitSubProvider implements GitTagsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
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
		repoPath: string,
		options?: {
			filter?: (t: GitTag) => boolean;
			paging?: PagingOptions;
			sort?: boolean | TagSortOptions;
		},
		cancellation?: CancellationToken,
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		const scope = getScopedLogger();

		let tagsResult = await this.cache.getTags(repoPath, async (commonPath, _cacheable) => {
			try {
				const parser = getTagParser();

				const result = await this.git.exec(
					{ cwd: repoPath, cancellation: cancellation },
					'for-each-ref',
					...parser.arguments,
					'refs/tags/',
				);
				if (!result.stdout) return emptyPagedResult;

				using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

				const tags: GitTag[] = [];

				for (const entry of parser.parse(result.stdout)) {
					tags.push(
						new GitTag(
							this.container,
							commonPath,
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
				scope?.error(ex);
				if (isCancellationError(ex)) throw ex;

				return emptyPagedResult;
			}
		});

		if (options?.filter != null) {
			tagsResult = {
				...tagsResult,
				values: tagsResult.values.filter(options.filter),
			};
		}

		if (options?.sort) {
			sortTags(tagsResult.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return tagsResult;
	}

	@debug()
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

	@debug()
	async createTag(repoPath: string, name: string, sha: string, message?: string): Promise<void> {
		const args = ['tag', name, sha];
		if (message != null && message.length > 0) {
			args.push('-m', message);
		}

		try {
			await this.git.exec({ cwd: repoPath }, ...args);
		} catch (ex) {
			throw getGitCommandError(
				'tag',
				ex,
				reason =>
					new TagError(
						{ reason: reason, action: 'create', tag: name, gitCommand: { repoPath: repoPath, args: args } },
						ex,
					),
			);
		}
	}

	@debug()
	async deleteTag(repoPath: string, name: string): Promise<void> {
		const args = ['tag', '-d', name];

		try {
			await this.git.exec({ cwd: repoPath }, ...args);
		} catch (ex) {
			throw getGitCommandError(
				'tag',
				ex,
				reason =>
					new TagError(
						{ reason: reason, action: 'delete', tag: name, gitCommand: { repoPath: repoPath, args: args } },
						ex,
					),
			);
		}
	}
}
