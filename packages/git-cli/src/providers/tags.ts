import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { TagError } from '@gitlens/git/errors.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import type { GitTagsSubProvider } from '@gitlens/git/providers/tags.js';
import type { TagSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortTags } from '@gitlens/git/utils/sorting.js';
import { filterMap } from '@gitlens/utils/array.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult } from '@gitlens/utils/paging.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git, GitError } from '../exec/git.js';
import { getGitCommandError, gitConfigsBranch } from '../exec/git.js';
import { getTagParser } from '../parsers/refParser.js';

export class TagsGitSubProvider implements GitTagsSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
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
		repoPath: string,
		options?: {
			filter?: (t: GitTag) => boolean;
			paging?: PagingOptions;
			sort?: boolean | TagSortOptions;
		},
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitTag>> {
		if (!repoPath) return emptyPagedResult;

		const scope = getScopedLogger();

		let tagsResult = await this.cache.getTags(
			repoPath,
			async (commonPath, _cacheable, signal) => {
				// Prefer the aggregate signal from the cache; fall back to the caller's cancellation.
				signal ??= cancellation;
				try {
					const parser = getTagParser();

					const result = await this.git.exec(
						{ cwd: repoPath, cancellation: signal },
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
								commonPath,
								entry.name,
								entry.sha || entry.tagSha,
								entry.message,
								entry.date ? new Date(entry.date) : undefined,
								entry.commitDate ? new Date(entry.commitDate) : undefined,
							),
						);
					}

					sw?.stop({ suffix: ` parsed ${String(tags.length)} tags` });

					return { values: tags };
				} catch (ex) {
					scope?.error(ex);
					if (isCancellationError(ex)) throw ex;

					return emptyPagedResult;
				}
			},
			cancellation,
		);

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
		cancellation?: AbortSignal,
	): Promise<string[]> {
		const result = await this.tagsContainingCore(repoPath, sha, options, cancellation);
		if (!result.stdout) return [];

		return filterMap(result.stdout.split('\n'), b => b.trim() || undefined);
	}

	private async tagsContainingCore(
		repoPath: string,
		sha: string,
		options?: { mode?: 'contains' | 'pointsAt' },
		cancellation?: AbortSignal,
	): Promise<GitResult> {
		const params: string[] = ['tag', '--format=%(refname:short)'];
		params.push(options?.mode === 'pointsAt' ? `--points-at=${sha}` : `--contains=${sha}`);

		return this.git.exec(
			{
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsBranch,
				errors: 'ignore',
			},
			...params,
		);
	}

	@debug()
	async createTag(repoPath: string, name: string, sha: string, message?: string): Promise<void> {
		const args = ['tag', name, sha];
		if (message != null && message.length > 0) {
			args.push('-m', message);
		}

		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['tags']);
		} catch (ex) {
			throw getGitCommandError(
				'tag',
				ex as GitError,
				reason =>
					new TagError(
						{ reason: reason, action: 'create', tag: name, gitCommand: { repoPath: repoPath, args: args } },
						ex as GitError,
					),
			);
		}
	}

	@debug()
	async deleteTag(repoPath: string, name: string): Promise<void> {
		const args = ['tag', '-d', name];

		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['tags']);
		} catch (ex) {
			throw getGitCommandError(
				'tag',
				ex as GitError,
				reason =>
					new TagError(
						{ reason: reason, action: 'delete', tag: name, gitCommand: { repoPath: repoPath, args: args } },
						ex as GitError,
					),
			);
		}
	}
}
