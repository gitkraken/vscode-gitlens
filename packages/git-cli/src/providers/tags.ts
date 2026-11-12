import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { TagError } from '@gitlens/git/errors.js';
import { GitTag } from '@gitlens/git/models/tag.js';
import type { GitTagsSubProvider } from '@gitlens/git/providers/tags.js';
import type { TagSortOptions } from '@gitlens/git/utils/sorting.js';
import { sortTags } from '@gitlens/git/utils/sorting.js';
import { ensureArray, filterMap } from '@gitlens/utils/array.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import { emptyPagedResult } from '@gitlens/utils/paging.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult } from '../exec/exec.types.js';
import type { Git, GitError } from '../exec/git.js';
import { getGitCommandError, gitConfigsBranch } from '../exec/git.js';

export class TagsGitSubProvider implements GitTagsSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug({ quiet: true })
	async getTag(repoPath: string, name: string, cancellation?: AbortSignal): Promise<GitTag | undefined> {
		if (!repoPath) return undefined;

		const { values } = await this.getSharedTags(repoPath, cancellation);
		return values.find(t => t.name === name)?.withRepoPath(repoPath);
	}

	/**
	 * Whether `getTags(repoPath)` holds a tag `matches` accepts (any when omitted), judged on each as that list would
	 * hold it, without keeping that worktree's copy of the list
	 */
	async hasTag(
		repoPath: string,
		matches: ((tag: GitTag) => boolean) | undefined,
		cancellation?: AbortSignal,
	): Promise<boolean> {
		if (!repoPath) return false;

		const { values } = await this.getSharedTags(repoPath, cancellation);
		return matches == null ? values.length !== 0 : values.some(t => matches(t.withRepoPath(repoPath)));
	}

	@debug({ quiet: true, args: repoPath => ({ repoPath: repoPath }) })
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
			(commonPath, cacheable, signal) => this.readTags(commonPath, cacheable, signal ?? cancellation, scope),
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

	/** The tags every worktree of `repoPath` shares, listed from the common path, read once whoever asks */
	private getSharedTags(repoPath: string, cancellation?: AbortSignal): Promise<PagedResult<GitTag>> {
		const scope = getScopedLogger();

		return this.cache.getSharedTags(
			repoPath,
			(commonPath, cacheable, signal) => this.readTags(commonPath, cacheable, signal ?? cancellation, scope),
			cancellation,
		);
	}

	private async readTags(
		commonPath: string,
		cacheable: CacheController,
		signal: AbortSignal | undefined,
		scope: ScopedLogger | undefined,
	): Promise<PagedResult<GitTag>> {
		try {
			const records = await this.provider.refs.getRefs(commonPath, signal);
			if (!records.length) {
				// Empty also means the listing failed; the listing's own cached answer covers a
				// repository that truly has no refs without another git run
				cacheable.invalidate();
				return emptyPagedResult;
			}

			using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

			const tags: GitTag[] = [];

			for (const record of records) {
				const fullName = record.name;
				if (!fullName.startsWith('refs/tags/')) continue;

				// Annotated tags: peeledObjectname is the commit SHA; objectname is the tag-object SHA.
				// Lightweight tags: peeledObjectname is empty; objectname is already the commit SHA.
				const annotated = Boolean(record.peeledObjectname);
				const sha = record.peeledObjectname || record.objectname;

				tags.push(
					new GitTag(
						commonPath,
						fullName,
						sha,
						record.subject,
						record.creatorDate ? new Date(record.creatorDate) : undefined,
						record.authorDate ? new Date(record.authorDate) : undefined,
						annotated,
					),
				);
			}

			sw?.stop({ suffix: ` parsed ${String(tags.length)} tags` });

			return { values: tags };
		} catch (ex) {
			cacheable.invalidate();
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return emptyPagedResult;
		}
	}

	@debug({ quiet: true })
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

		return this.git.run(
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
			await this.git.run({ cwd: repoPath }, ...args);
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
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['tags']);
		}
	}

	@debug()
	async deleteTag(repoPath: string, name: string): Promise<void> {
		const args = ['tag', '-d', name];

		try {
			await this.git.run({ cwd: repoPath }, ...args);
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
		} finally {
			this.context.hooks?.cache?.onReset?.(repoPath, 'tags');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['tags']);
		}
	}

	@debug()
	async pushTag(
		repoPath: string,
		name: string | string[],
		remote: string,
		options?: { force?: boolean },
	): Promise<void> {
		const names = ensureArray(name);
		const args = ['push'];
		if (options?.force) {
			args.push('--force');
		}

		args.push(remote, ...names.map(n => `refs/tags/${n}`));

		try {
			await this.git.run({ cwd: repoPath }, ...args);
		} catch (ex) {
			throw getGitCommandError(
				'tag',
				ex as GitError,
				reason =>
					new TagError(
						{
							reason: reason,
							action: 'push',
							tag: names.join(', '),
							gitCommand: { repoPath: repoPath, args: args },
						},
						ex as GitError,
					),
			);
		}
	}
}
