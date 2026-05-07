import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitBlame } from '@gitlens/git/models/blame.js';
import type { GitStashCommit } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import type { GitDiffFilter, ParsedGitDiffHunks } from '@gitlens/git/models/diff.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitLog } from '@gitlens/git/models/log.js';
import type { GitReflog } from '@gitlens/git/models/reflog.js';
import type { GitRevisionRange } from '@gitlens/git/models/revision.js';
import type { SearchQuery, SearchQueryFilters } from '@gitlens/git/models/search.js';
import type { CommitSignature } from '@gitlens/git/models/signature.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type {
	GitCommitReachability,
	GitCommitsSubProvider,
	GitLogForPathOptions,
	GitLogOptions,
	GitLogShasOptions,
	GitSearchCommitsOptions,
	IncomingActivityOptions,
	LeftRightCommitCountResult,
	SearchCommitsResult,
} from '@gitlens/git/providers/commits.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { createUncommittedChangesCommit } from '@gitlens/git/utils/commit.utils.js';
import { isRevisionRange, isSha, isUncommitted, isUncommittedStaged } from '@gitlens/git/utils/revision.utils.js';
import { parseSearchQueryGitCommand } from '@gitlens/git/utils/search.utils.js';
import { compareReachableRefs } from '@gitlens/git/utils/sorting.js';
import { isUserMatch } from '@gitlens/git/utils/user.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { filterMap, findLast, first, join, last, some } from '@gitlens/utils/iterable.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { isFolderGlob, normalizePath, splitPath, stripFolderGlob } from '@gitlens/utils/path.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { escapeRegex } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitResult, GitRunOptions } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { gitConfigsLog, gitConfigsLogWithFiles, GitErrors } from '../exec/git.js';
import type {
	CommitsInFileRangeLogParser,
	CommitsLogParser,
	CommitsWithFilesLogParser,
	ParsedCommit,
} from '../parsers/logParser.js';
import {
	getCommitsLogParser,
	getShaAndDatesLogParser,
	getShaAndFilesAndStatsLogParser,
	getShaLogParser,
} from '../parsers/logParser.js';
import { getReflogParser, parseGitRefLog } from '../parsers/reflogParser.js';
import { parseSignatureOutput, signatureFormat } from '../parsers/signatureParser.js';
import { createCommitFileset } from './commitFilesetUtils.js';
import { convertStashesToStdin } from './stash.js';

const emptyPromise: Promise<GitBlame | ParsedGitDiffHunks | GitLog | undefined> = Promise.resolve(undefined);
const reflogCommands = ['merge', 'pull'];

export class CommitsGitSubProvider implements GitCommitsSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@debug()
	async createUnreachableCommitFromTree(
		repoPath: string,
		tree: string,
		parent: string,
		message: string,
		cancellation?: AbortSignal,
	): Promise<string> {
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'throw' },
			'commit-tree',
			tree,
			'-p',
			parent,
			'-m',
			message,
		);
		return result.stdout.trim();
	}

	@debug()
	async getCommit(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<GitCommit | undefined> {
		if (isUncommitted(rev, true)) {
			return createUncommittedChangesCommit(
				repoPath,
				rev,
				new Date(),
				await this.provider.config.getCurrentUser(repoPath),
			);
		}

		const log = await this.getLogCore(repoPath, rev, { limit: 1 }, cancellation);
		if (log == null) return undefined;

		return log.commits.get(rev) ?? first(log.commits.values());
	}

	@debug({ exit: true })
	async getCommitCount(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<number | undefined> {
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
			'rev-list',
			'--count',
			rev,
			'--',
		);
		if (result.cancelled || cancellation?.aborted) {
			throw new CancellationError();
		}

		const data = result.stdout.trim();
		if (!data) return undefined;

		const count = parseInt(data, 10);
		return isNaN(count) ? undefined : count;
	}

	@debug({ exit: true })
	async getCommitDates(
		repoPath: string,
		rev: string,
		cancellation?: AbortSignal,
	): Promise<{ authorDate: Date; committerDate: Date } | undefined> {
		const parser = getShaAndDatesLogParser();
		const result = await this.git.run(
			{
				cwd: repoPath,
				cancellation: cancellation,
				errors: 'ignore',
				// Why: full SHAs identify immutable commits (5-min TTL is safe). Non-SHA refs rely on
				// gitResults being cleared on 'head'/'heads'/'remotes' events; the 60s TTL is the
				// failsafe for watcher latency / web (no fs watcher).
				caching: {
					cache: this.cache.gitResults,
					options: { accessTTL: isSha(rev) ? 5 * 60 * 1000 : 60 * 1000 },
				},
			},
			'log',
			'-1',
			...parser.arguments,
			rev,
		);
		if (result.cancelled || cancellation?.aborted) return undefined;

		for (const entry of parser.parse(result.stdout)) {
			const authorSeconds = Number(entry.authorDate);
			const committerSeconds = Number(entry.committerDate);
			if (!Number.isFinite(authorSeconds) || !Number.isFinite(committerSeconds)) return undefined;
			return {
				authorDate: new Date(authorSeconds * 1000),
				committerDate: new Date(committerSeconds * 1000),
			};
		}
		return undefined;
	}

	@debug()
	async getCommitFiles(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<GitFileChange[]> {
		const parser = getShaAndFilesAndStatsLogParser();
		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
			'log',
			...parser.arguments,
			'-n1',
			rev && !isUncommittedStaged(rev) ? rev : undefined,
			'--',
		);

		const repoUri = fileUri(normalizePath(repoPath));
		const files = first(parser.parse(result.stdout))?.files.map(
			f =>
				new GitFileChange(
					repoPath,
					f.path,
					f.status as GitFileStatus,
					joinUriPath(repoUri, normalizePath(f.path)),
					f.originalPath,
					f.originalPath != null ? joinUriPath(repoUri, normalizePath(f.originalPath)) : undefined,
					undefined,
					{ additions: f.additions, deletions: f.deletions, changes: 0 },
					undefined,
					undefined,
					f.mode,
					f.oid ? { oid: f.oid, previousOid: f.previousOid } : undefined,
				),
		);

		return files ?? [];
	}

	@debug()
	async getCommitForFile(
		repoPath: string,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		options?: { firstIfNotFound?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitCommit | undefined> {
		const scope = getScopedLogger();

		const [relativePath, root] = splitPath(toFsPath(pathOrUri), repoPath);

		try {
			const log = await this.getLogForPath(root, relativePath, rev, { limit: 1 }, cancellation);
			if (log == null) return undefined;

			let commit;
			if (rev) {
				commit = log.commits.get(rev);
				if (commit == null && !options?.firstIfNotFound) {
					// If the ref isn't a valid sha we will never find it, so let it fall through so we return the first
					if (isSha(rev) || isUncommitted(rev)) return undefined;
				}
			}

			return commit ?? first(log.commits.values());
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@debug()
	getCommitReachability(
		repoPath: string,
		rev: string,
		cancellation?: AbortSignal,
	): Promise<GitCommitReachability | undefined> {
		if (repoPath == null || isUncommitted(rev)) return Promise.resolve(undefined);

		const scope = getScopedLogger();

		const getCore = async (cacheable?: CacheController) => {
			try {
				// Use for-each-ref with %(HEAD) to mark current branch with *
				const result = await this.git.run(
					{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
					'for-each-ref',
					'--contains',
					rev,
					'--format=%(HEAD)%(refname)',
					'--sort=-version:refname',
					'--sort=-committerdate',
					'--sort=-HEAD',
					'refs/heads/',
					'refs/remotes/',
					'refs/tags/',
				);
				if (cancellation?.aborted) throw new CancellationError();

				const refs: GitCommitReachability['refs'] = [];

				// Parse branches from refs/heads/ and refs/remotes/
				if (result?.stdout) {
					const lines = result.stdout.split('\n');

					for (let line of lines) {
						line = line.trim();
						if (!line) continue;

						// %(HEAD) outputs '*' for current branch, ' ' for others
						const isCurrent = line.startsWith('*');
						const refname = isCurrent ? line.substring(1) : line; // Skip the HEAD marker

						// Skip HEADs
						if (refname.endsWith('/HEAD')) continue;

						if (refname.startsWith('refs/heads/')) {
							// Remove 'refs/heads/'
							const name = refname.substring(11);
							refs.push({
								refType: 'branch',
								name: name,
								remote: false,
								current: isCurrent,
							});
						} else if (refname.startsWith('refs/remotes/')) {
							// Remove 'refs/remotes/'
							refs.push({ refType: 'branch', name: refname.substring(13), remote: true });
						} else if (refname.startsWith('refs/tags/')) {
							// Remove 'refs/tags/'
							refs.push({ refType: 'tag', name: refname.substring(10) });
						}
					}
				}

				// git already returns sorted by -HEAD, -committerdate, -version:refname;
				// compareReachableRefs refines by current-first / local-before-remote / tag-version.
				refs.sort(compareReachableRefs);

				return { refs: refs };
			} catch (ex) {
				cacheable?.invalidate();
				debugger;
				if (isCancellationError(ex)) throw ex;

				scope?.error(ex);

				return undefined;
			}
		};

		return this.cache.reachability.getOrCreate(repoPath, rev, getCore);
	}

	@debug()
	async getIncomingActivity(
		repoPath: string,
		options?: IncomingActivityOptions,
		cancellation?: AbortSignal,
	): Promise<GitReflog | undefined> {
		const scope = getScopedLogger();

		const cfg = this.context.config;
		const parser = getReflogParser();
		const args = ['--walk-reflogs', ...parser.arguments, '--date=iso8601'];

		const ordering = options?.ordering ?? cfg?.commits.ordering;
		if (ordering) {
			args.push(`--${ordering}-order`);
		}

		if (options?.all) {
			args.push('--all');
		}

		// Pass a much larger limit to reflog, because we aggregate the data and we won't know how many lines we'll need
		const limit = (options?.limit ?? cfg?.commits.maxItems ?? 0) * 100;
		if (limit) {
			args.push(`-n${limit}`);
		}

		if (options?.skip) {
			args.push(`--skip=${options.skip}`);
		}

		try {
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog, priority: 'background' },
				'log',
				...args,
			);

			const reflog = parseGitRefLog(parser, result.stdout, repoPath, reflogCommands, limit, limit * 100);
			if (reflog?.hasMore) {
				reflog.more = this.getReflogMoreFn(reflog, options);
			}

			return reflog;
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	private getReflogMoreFn(
		reflog: GitReflog,
		options?: IncomingActivityOptions,
	): (limit: number) => Promise<GitReflog> {
		return async (limit: number | undefined) => {
			limit = limit ?? 0;

			const moreLog = await this.getIncomingActivity(reflog.repoPath, {
				...options,
				limit: limit,
				skip: reflog.total,
			});
			if (moreLog == null) {
				// If we can't find any more, assume we have everything
				return { ...reflog, hasMore: false, more: undefined };
			}

			const mergedLog: GitReflog = {
				repoPath: reflog.repoPath,
				records: [...reflog.records, ...moreLog.records],
				count: reflog.count + moreLog.count,
				total: reflog.total + moreLog.total,
				limit: (reflog.limit ?? 0) + limit,
				hasMore: moreLog.hasMore,
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getReflogMoreFn(mergedLog, options);
			}

			return mergedLog;
		};
	}

	@debug({ exit: true })
	getInitialCommitSha(repoPath: string, cancellation?: AbortSignal): Promise<string | undefined> {
		// Initial commit SHA is shared across all worktrees
		return this.cache.getInitialCommitSha(repoPath, async commonPath => {
			try {
				const result = await this.git.run(
					{ cwd: commonPath, cancellation: cancellation, errors: 'ignore' },
					'rev-list',
					`--max-parents=0`,
					'HEAD',
					'--',
				);
				if (result.cancelled || cancellation?.aborted) {
					throw new CancellationError();
				}

				return result.stdout.trim().split('\n')?.[0];
			} catch (ex) {
				if (isCancellationError(ex)) throw ex;

				return undefined;
			}
		});
	}

	@debug()
	async getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[]; excludeMerges?: boolean },
		cancellation?: AbortSignal,
	): Promise<LeftRightCommitCountResult | undefined> {
		const authors = options?.authors?.length
			? options.authors.map(a => `--author=^${escapeRegex(a.name ?? '')} <${escapeRegex(a.email ?? '')}>$`)
			: [];

		const run = async (): Promise<LeftRightCommitCountResult | undefined> => {
			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
				'rev-list',
				'--left-right',
				'--count',
				...authors,
				options?.excludeMerges ? '--no-merges' : undefined,
				range,
				'--',
			);
			if (result.cancelled || cancellation?.aborted) {
				throw new CancellationError();
			}
			if (!result.stdout) return undefined;

			const parts = result.stdout.split('\t');
			if (parts.length !== 2) return undefined;

			const [left, right] = parts;
			const counts = {
				left: parseInt(left, 10),
				right: parseInt(right, 10),
			};

			if (isNaN(counts.left) || isNaN(counts.right)) return undefined;

			return counts;
		};

		// Author-filtered calls are one-off (e.g. "who made these commits") with low re-hit
		// rate; skip the cache to protect its capacity for the hot no-author merge-target path.
		if (authors.length > 0) return run();

		// Cache key: range + excludeMerges. RepositoryChange events affecting branches/remotes
		// invalidate this cache via clearCaches('branches').
		const cacheKey = `${range}\x1f${options?.excludeMerges ? 'no-merges' : ''}`;
		return this.cache.leftRightCommitCount.getOrCreate(repoPath, cacheKey, run);
	}

	@debug()
	async getLog(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions,
		cancellation?: AbortSignal,
	): Promise<GitLog | undefined> {
		return this.getLogCore(repoPath, rev, options, cancellation);
	}

	@trace({ args: (repoPath, rev) => ({ repoPath: repoPath, rev: rev }), exit: true })
	private async getLogCore(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogOptions & {
			path?: { pathspec: string; filters?: GitDiffFilter[]; range?: DiffRange; renames?: boolean };
		},
		cancellation?: AbortSignal,
		additionalArgs?: string[],
	): Promise<GitLog | undefined> {
		const scope = getScopedLogger();

		try {
			const currentUserPromise = this.provider.config.getCurrentUser(repoPath);

			const cfg = this.context.config;
			const limit = options?.limit ?? cfg?.commits.maxItems ?? 0;
			const isSingleCommit = limit === 1;

			const cfgIncludeFiles = options?.includeFiles ?? cfg?.commits.includeFileDetails ?? true;
			const includeFiles = cfgIncludeFiles || isSingleCommit || Boolean(options?.path?.pathspec);

			const parser = getCommitsLogParser(includeFiles, Boolean(options?.path?.pathspec && options?.path?.range));
			const args = ['log', ...parser.arguments];

			const similarityThreshold = options?.similarityThreshold ?? cfg?.commits.similarityThreshold;
			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`, '--use-mailmap');

			if (options?.all) {
				args.push('--all');
				if (options?.path?.pathspec) {
					args.push('--single-worktree');
				}
			}

			const merges = options?.merges ?? true;
			if (merges) {
				// If we are are asking for a specific ref, ensure we return the merge commit files
				if (isSingleCommit) {
					args.push('-m');
				}
				args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
			} else {
				args.push('--no-merges');
			}

			const ordering = options?.ordering ?? cfg?.commits.ordering;
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (options?.authors?.length) {
				args.push(
					...options.authors.map(
						a => `--author=^${escapeRegex(a.name ?? '')} <${escapeRegex(a.email ?? '')}>$`,
					),
				);
			}

			let overrideHasMore;

			if (options?.since) {
				overrideHasMore = true;
				args.push(`--since="${options.since}"`);
			}

			if (options?.until) {
				overrideHasMore = true;
				args.push(`--until="${options.until}"`);
			}

			if (additionalArgs?.length) {
				args.push(...additionalArgs);
			}

			if (limit > 0) {
				overrideHasMore = isSingleCommit ? false : undefined;
				// Add 1 to the limit so we can check if there are more commits
				args.push(`-n${isSingleCommit ? 1 : limit + 1}`);
			}

			let stashes: ReadonlyMap<string, GitStashCommit> | undefined;

			if (!isSingleCommit && options?.stashes) {
				stashes =
					typeof options.stashes === 'boolean'
						? (await this.provider.stash?.getStash(repoPath, { reachableFrom: rev }, cancellation))?.stashes
						: options.stashes;
				if (stashes?.size) {
					rev ??= 'HEAD';
				}
			}

			if (rev && !isUncommittedStaged(rev)) {
				args.push(rev);
			}

			let pathspec: string | undefined;
			let pathspecRange: `${number},${number}` | undefined;

			if (options?.path?.pathspec) {
				pathspec = options.path.pathspec;
				const { filters, range, renames } = options.path;

				if (filters?.length) {
					args.push(`--diff-filter=${filters.join('')}`);
				}

				if (range != null) {
					// Git doesn't allow rename detection (`--follow`) if a range is used

					const [start, end] = getGitStartEnd(range);
					pathspecRange = `${start},${end}`;
					args.push(`-L ${pathspecRange}:${pathspec}`, '--');
				} else {
					if (renames !== false) {
						args.push('--follow');
					}
					args.push('--', pathspec);
				}
			} else {
				args.push('--');
			}

			const currentUser = await currentUserPromise.catch(() => undefined);
			if (cancellation?.aborted) throw new CancellationError();

			const cmdOpts: GitRunOptions = {
				cwd: repoPath,
				cancellation: cancellation,
				configs: gitConfigsLogWithFiles,
				// Single-commit log serves user-initiated reads (commit details, hover, etc.).
				// Mirrors getCommitDates: full SHAs are immutable so a 5-min TTL is safe; non-SHA refs
				// rely on gitResults being cleared on head/heads/remotes events (60s is the failsafe
				// for watcher latency / web with no fs watcher).
				...(isSingleCommit && rev
					? {
							caching: {
								cache: this.cache.gitResults,
								options: { accessTTL: isSha(rev) ? 5 * 60 * 1000 : 60 * 1000 },
							},
						}
					: undefined),
			};
			let { commits, count } = await parseCommits(
				parser,
				isSingleCommit ? this.git.run(cmdOpts, ...args) : this.git.stream(cmdOpts, ...args),
				repoPath,
				pathspec,
				limit,
				undefined,
				currentUser,
			);

			// If we didn't find any history from the working tree, check to see if the file was renamed
			if (rev == null && pathspec && !commits.size) {
				const status = await this.provider.status?.getStatusForFile?.(
					repoPath,
					pathspec,
					undefined,
					cancellation,
				);
				if (status?.originalPath != null) {
					pathspec = status.originalPath;

					if (pathspecRange) {
						const index = args.findIndex(a => a.startsWith('-L '));
						args.splice(index, 1, `-L ${pathspecRange}:${pathspec}`);
					} else {
						args.splice(args.length - 1, 1, pathspec);
					}

					({ commits, count } = await parseCommits(
						parser,
						isSingleCommit ? this.git.run(cmdOpts, ...args) : this.git.stream(cmdOpts, ...args),
						repoPath,
						pathspec,
						limit,
						undefined,
						currentUser,
					));
				}
			}

			// Merge stashes in-memory rather than via `git log --stdin <stash>` — git would
			// walk each stash's parent chains and pull in pre-rebase ancestors that aren't
			// reachable from <rev>. Slot each stash directly above its first parent; stashes
			// whose parent isn't in the result (rebased away, or below the current limit) are
			// dropped — the Stashes view still surfaces them, and they reappear here if the
			// parent loads via "Load more".
			if (stashes?.size) {
				// `stashes` arrives in `git stash list` order (newest @{0} first), so per-parent
				// groups naturally land newest-first without an explicit sort
				const stashesByParent = new Map<string, GitStashCommit[]>();
				for (const stash of stashes.values()) {
					const parentSha = stash.parents[0];
					if (parentSha == null || !commits.has(parentSha)) continue;

					const group = stashesByParent.get(parentSha);
					if (group != null) {
						group.push(stash);
					} else {
						stashesByParent.set(parentSha, [stash]);
					}
				}

				if (stashesByParent.size) {
					const cap = limit > 0 ? limit + 1 : Number.POSITIVE_INFINITY;
					const merged = new Map<string, GitCommit>();
					outer: for (const c of commits.values()) {
						const group = stashesByParent.get(c.sha);
						if (group != null) {
							for (const s of group) {
								if (merged.size >= cap) break outer;

								merged.set(s.sha, s);
							}
						}
						if (merged.size >= cap) break;

						merged.set(c.sha, c);
					}
					commits = merged;
				}
			}

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: isRevisionRange(rev) ? undefined : rev,
				count: commits.size,
				limit: limit,
				hasMore: overrideHasMore ?? (limit > 0 && count > limit),
			};

			if (!isSingleCommit) {
				log.query = (limit: number | undefined) =>
					this.getLogCore(repoPath, rev, { ...options, limit: limit }, undefined, additionalArgs);
				if (log.hasMore) {
					log.more = this.getLogCoreMoreFn(log, rev, options);
				}
			}

			return log;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			// Check if this is a "bad object" error due to a submodule's internal SHA
			const pathspec = options?.path?.pathspec;
			if (rev && pathspec && ex instanceof Error && GitErrors.badObject.test(ex.message)) {
				const tree = await this.provider.revision.getTreeEntryForRevision(repoPath, pathspec, 'HEAD');
				if (tree?.type === 'commit') {
					// It's a submodule - retry without the rev and without rename tracking
					return this.getLogCore(
						repoPath,
						undefined,
						{ ...options, path: { ...options.path, pathspec: pathspec, renames: false } },
						cancellation,
						additionalArgs,
					);
				}
			}

			scope?.error(ex);
			debugger;

			return undefined;
		}
	}

	private getLogCoreMoreFn(
		log: GitLog,
		rev: string | undefined,
		options?: GitLogOptions & {
			path?: { pathspec: string; filters?: GitDiffFilter[]; range?: DiffRange; renames?: boolean };
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? 0;

			// If the log is for a range, then just get everything prior + more
			if (isRevisionRange(log.sha)) {
				const moreLog = await this.getLogCore(log.repoPath, rev, {
					...options,
					limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
				});
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				return moreLog;
			}

			// Stashes are not part of the normal commit history, so we need to find the last non-stash commit for the cursor
			const lastCommit = findLast(log.commits.values(), c => !GitCommit.isStash(c)) ?? last(log.commits.values());
			const sha = lastCommit?.ref;

			// Check to make sure the filename hasn't changed and if it has use the previous
			const lastCommitFile = lastCommit?.anyFiles?.[0];
			if (options?.path?.pathspec && lastCommitFile != null) {
				const path = lastCommitFile.originalPath ?? lastCommitFile.path;
				if (path !== options.path.pathspec) {
					options = { ...options, path: { ...options.path, pathspec: path } };
				}
			}

			// If we were asked for all refs, use the last commit timestamp (plus a second) as a cursor
			let timestamp: number | undefined;
			if (options?.all) {
				const date = lastCommit?.committer.date;
				// Git only allows 1-second precision, so round up to the nearest second
				timestamp = date != null ? Math.ceil(date.getTime() / 1000) + 1 : undefined;
			}

			let moreLogCount;
			let queryLimit = moreUntil == null ? moreLimit : 0;
			do {
				const moreLog = await this.getLogCore(
					log.repoPath,
					timestamp ? rev : moreUntil == null ? `${sha}^` : `${moreUntil}^..${sha}^`,
					{
						...options,
						limit: queryLimit,
						...(timestamp ? { until: timestamp } : undefined),
					},
					undefined,
					timestamp ? ['--boundary'] : undefined,
				);
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				const currentCount = log.commits.size;
				const commits = new Map([...log.commits, ...moreLog.commits]);

				if (currentCount === commits.size && queryLimit !== 0) {
					// If we didn't find any new commits, we must have them all so return that we have everything
					if (moreLogCount === moreLog.commits.size) {
						return { ...log, hasMore: false, more: undefined };
					}

					moreLogCount = moreLog.commits.size;
					queryLimit = queryLimit * 2;
					continue;
				}

				if (timestamp != null && sha != null && !moreLog.commits.has(sha)) {
					debugger;
				}

				const mergedLog: GitLog = {
					repoPath: log.repoPath,
					commits: commits,
					sha: log.sha,
					count: commits.size,
					limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
					hasMore: moreUntil == null ? moreLog.hasMore : true,
					// The oldest commit SHA of the previous page — the graph webview compares this
					// against its last displayed row to determine the merge point for appending new rows
					startingCursor: sha,
					endingCursor: moreLog.endingCursor,
					pagedCommits: () => {
						// Remove any duplicates
						for (const sha of log.commits.keys()) {
							moreLog.commits.delete(sha);
						}
						return moreLog.commits;
					},
					// eslint-disable-next-line no-loop-func
					query: (limit: number | undefined) =>
						this.getLogCore(log.repoPath, rev, { ...options, limit: limit }),
				};
				if (mergedLog.hasMore) {
					mergedLog.more = this.getLogCoreMoreFn(mergedLog, rev, options);
				}

				return mergedLog;
			} while (true);
		};
	}

	@debug()
	async getLogForPath(
		repoPath: string | undefined,
		pathOrUri: string | Uri,
		rev?: string | undefined,
		options?: GitLogForPathOptions,
		cancellation?: AbortSignal,
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const scope = getScopedLogger();

		let relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`Path cannot match the repository path; path=${relativePath}`);
		}

		const cfg = this.context.config;
		options = {
			...options,
			all: options?.all ?? cfg?.fileHistory?.showAllBranches,
			limit: options?.limit ?? cfg?.commits.maxItems ?? 0,
			merges: options?.merges ?? cfg?.fileHistory?.showMergeCommits,
			ordering: options?.ordering ?? cfg?.commits.ordering ?? undefined,
			renames: options?.renames ?? cfg?.fileHistory?.followRenames,
			similarityThreshold: options?.similarityThreshold ?? cfg?.commits.similarityThreshold,
		};

		if (isFolderGlob(relativePath)) {
			relativePath = stripFolderGlob(relativePath);
			options.isFolder = true;
		} else if (options.isFolder == null) {
			const tree = await this.provider.revision.getTreeEntryForRevision(repoPath, relativePath, rev || 'HEAD');
			if (cancellation?.aborted) throw new CancellationError();

			if (tree?.type === 'commit') {
				// It's a submodule — line ranges and rename tracking don't apply, and the rev may reference
				// the submodule's internal SHA which isn't valid in the parent repo
				options.range = undefined;
				options.renames = false;
				// rev = undefined;
			} else {
				options.isFolder = tree?.type === 'tree';
			}
		}

		// Build cache key — only for non-folder, non-filtered queries
		let cacheKey: string | undefined;
		if (
			!options.isFolder &&
			options.authors == null &&
			options.cursor == null &&
			options.filters == null &&
			options.range == null &&
			options.since == null &&
			options.until == null
		) {
			let suffix = 'log';
			if (rev != null) {
				suffix += `:${rev}`;
			}
			if (options.all) {
				suffix += ':all';
			}
			if (options.limit) {
				suffix += `:n${options.limit}`;
			}
			if (options.merges) {
				suffix += `:merges=${options.merges}`;
			}
			if (options.ordering) {
				suffix += `:ordering=${options.ordering}`;
			}
			if (options.renames) {
				suffix += ':follow';
			}
			cacheKey = `${normalizePath(relativePath)}:${suffix}`;
		}

		if (cacheKey != null) {
			// Check for exact cache hit
			const cached = this.cache.fileLog.get(repoPath, cacheKey);
			if (cached != null) {
				scope?.trace(`Cache hit: '${cacheKey}'`);
				return cached;
			}

			// Subset optimization: if requesting partial log, check if whole-file log is cached
			if (rev != null || (options.limit != null && options.limit !== 0)) {
				const baseKey = `${normalizePath(relativePath)}:log${options.renames ? ':follow' : ''}`;
				const baseLog = this.cache.fileLog.get(repoPath, baseKey);
				if (baseLog != null) {
					if (rev == null) {
						scope?.trace(`Cache hit: ~'${cacheKey}'`);
						return baseLog;
					}

					scope?.trace(`Cache ?: '${cacheKey}'`);
					const log = await baseLog;
					if (log != null && !log.hasMore && log.commits.has(rev)) {
						scope?.trace(`Cache hit: '${cacheKey}'`);

						// Create a copy of the log starting at the requested commit
						let skip = true;
						let i = 0;
						const limit = options.limit;
						const commits = new Map(
							filterMap<[string, GitCommit], [string, GitCommit]>(log.commits.entries(), ([sha, c]) => {
								if (skip) {
									if (sha !== rev) return undefined;
									skip = false;
								}

								i++;
								if (limit != null && i > limit) {
									return undefined;
								}

								return [sha, c];
							}),
						);

						const optsCopy = { ...options };
						return {
							...log,
							limit: optsCopy.limit,
							count: commits.size,
							commits: commits,
							query: (limit: number | undefined) =>
								this.getLogForPath(repoPath, pathOrUri, rev, {
									...optsCopy,
									limit: limit,
								}),
						};
					}
				}
			}

			scope?.trace(`Cache miss: '${cacheKey}'`);

			return this.cache.fileLog.getOrCreate(
				repoPath,
				cacheKey,
				(_cacheable, signal) => this.getLogForPathCore(repoPath, relativePath, rev, options, signal),
				{ cancellation: cancellation },
			);
		}

		return this.getLogForPathCore(repoPath, relativePath, rev, options, cancellation);
	}

	private async getLogForPathCore(
		repoPath: string,
		path: string,
		rev: string | undefined,
		options: GitLogForPathOptions,
		cancellation?: AbortSignal,
	): Promise<GitLog | undefined> {
		const scope = getScopedLogger();

		const tracked = await this.provider.isTrackedWithDetails(path, repoPath, rev);
		if (cancellation?.aborted) throw new CancellationError();

		if (tracked == null) {
			scope?.debug(`Skipping log; '${path}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const relativePath = tracked.path;
		const root = repoPath;

		const log = await this.getLogCore(
			root,
			rev,
			{
				all: options.all,
				authors: options.authors,
				cursor: options.cursor,
				limit: options.limit,
				merges: options.merges,
				ordering: options.ordering,
				since: options.since,
				until: options.until,
				path: {
					pathspec: relativePath,
					filters: options.filters,
					range: options.range,
					renames: options.renames,
				},
			},
			cancellation,
		);

		return log;
	}

	@debug()
	async getLogShas(
		repoPath: string,
		rev?: string | undefined,
		options?: GitLogShasOptions,
		cancellation?: AbortSignal,
	): Promise<Iterable<string>> {
		const scope = getScopedLogger();

		const cfg = this.context.config;
		options ??= {};
		options.limit ??= cfg?.commits.maxItems ?? 0;
		options.ordering ??= cfg?.commits.ordering ?? undefined;
		options.similarityThreshold ??= cfg?.commits.similarityThreshold;
		options.merges ??= true;

		const getCore = async (): Promise<string[]> => {
			try {
				const parser = getShaLogParser();
				const args = [...parser.arguments];

				if (options.all) {
					args.push(`--all`);
				}

				if (options.ordering) {
					args.push(`--${options.ordering}-order`);
				}

				if (options.limit) {
					args.push(`-n${options.limit}`);
				}

				if (options.since) {
					args.push(`--since="${options.since}"`);
				}

				if (options.merges) {
					args.push(options.merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
				} else {
					args.push('--no-merges');
				}

				if (options.reverse) {
					args.push('--reverse');
				}

				if (options.authors?.length) {
					if (!args.includes('--use-mailmap')) {
						args.push('--use-mailmap');
					}
					args.push(
						...options.authors.map(
							a => `--author=^${escapeRegex(a.name ?? '')} <${escapeRegex(a.email ?? '')}>$`,
						),
					);
				}

				const pathspec =
					options.pathOrUri != null ? this.provider.getRelativePath(options.pathOrUri, repoPath) : undefined;
				if (pathspec) {
					const similarityThreshold = options.similarityThreshold;
					args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);
				}

				if (rev && !isUncommittedStaged(rev)) {
					args.push(rev);
				}

				args.push('--');

				if (pathspec) {
					args.push(pathspec);
				}

				const result = await this.git.run(
					{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
					'log',
					...args,
				);
				return [...parser.parse(result.stdout)];
			} catch (ex) {
				scope?.error(ex);
				if (isCancellationError(ex)) throw ex;
				debugger;

				return [];
			}
		};

		// Cache simple queries (no pathspec, no authors) as these are on hot paths (e.g. getting unpublished commits)
		const cacheable = !options.pathOrUri && !options.authors?.length && !options.reverse && !options.all;

		if (cacheable) {
			return this.cache.logShas.getOrCreate(
				repoPath,
				`${rev ?? ''}:${options.ordering ?? ''}:${options.limit}:${options.merges}:${options.since ?? ''}`,
				() => getCore(),
			);
		}

		return getCore();
	}

	@debug()
	async getOldestUnpushedShaForPath(
		repoPath: string,
		pathOrUri: string | Uri,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		const scope = getScopedLogger();

		try {
			const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

			const parser = getShaLogParser();

			const result = await this.git.run(
				{ cwd: repoPath, cancellation: cancellation, configs: gitConfigsLog },
				'log',
				...parser.arguments,
				'--follow',
				'--reverse',
				'@{u}..',
				'--',
				relativePath,
			);
			return first(parser.parse(result.stdout));
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;
			debugger;

			return undefined;
		}
	}

	@debug()
	async hasCommitBeenPushed(repoPath: string, rev: string, cancellation?: AbortSignal): Promise<boolean> {
		if (repoPath == null) return false;

		return this.isAncestorOf(repoPath, rev, '@{u}', cancellation);
	}

	@debug()
	async isAncestorOf(repoPath: string, rev1: string, rev2: string, cancellation?: AbortSignal): Promise<boolean> {
		if (repoPath == null) return false;

		const result = await this.git.run(
			{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
			'merge-base',
			'--is-ancestor',
			rev1,
			rev2,
		);
		return result.exitCode === 0;
	}

	@debug({
		args: (repoPath, s) => ({
			repoPath: repoPath,
			search: `[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}${
				s.matchWholeWord ? 'W' : ''
			}]: ${s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query}`,
		}),
	})
	async searchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: GitSearchCommitsOptions,
		cancellation?: AbortSignal,
	): Promise<SearchCommitsResult> {
		const scope = getScopedLogger();

		search = { matchAll: false, matchCase: false, matchRegex: true, matchWholeWord: false, ...search };

		// Pre-process natural language search queries via the host-provided hook
		if (
			search.naturalLanguage &&
			(typeof search.naturalLanguage !== 'object' || !search.naturalLanguage.processedQuery)
		) {
			search = (await this.context.searchQuery?.preprocessQuery?.(search, options?.source)) ?? search;
		}

		try {
			const cfg = this.context.config;
			const currentUser = await this.provider.config.getCurrentUser(repoPath);
			if (cancellation?.aborted) throw new CancellationError();

			const parser = getCommitsLogParser(true);

			const similarityThreshold = options?.similarityThreshold ?? cfg?.commits.similarityThreshold;
			const args = [
				'log',
				...parser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			const { args: searchArgs, files, shas, filters } = parseSearchQueryGitCommand(search, currentUser);

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (shas?.size) {
				stdin = join(shas, '\n');
				args.push('--no-walk');
			} else if (!filters.refs) {
				// Don't include stashes when using ref: filter, as they would add unrelated commits
				// There *HAS* to be a better way to get git log to return stashes, but this is the best we've found
				({ stdin, stashes } = convertStashesToStdin(
					await this.provider.stash?.getStash(repoPath, undefined, cancellation),
				));
			}

			if (stdin) {
				args.push('--stdin');
			}

			const limit = options?.limit ?? cfg?.search?.maxItems ?? 0;
			if (limit && !shas?.size) {
				args.push(`-n${limit + 1}`);
			}

			const ordering = options?.ordering ?? cfg?.commits.ordering;
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (options?.skip) {
				args.push(`--skip=${options.skip}`);
			}

			// Add the search args, but skip any shas (as they are already included in the stdin)
			for (const arg of searchArgs) {
				if (shas?.has(arg) || args.includes(arg)) continue;

				args.push(arg);
			}

			const pathspec = files?.join(' ');
			const { commits, count, countStashChildCommits } = await parseCommits(
				parser,
				this.git.stream(
					{
						cwd: repoPath,
						cancellation: cancellation,
						configs: ['-C', repoPath, ...gitConfigsLog],
						stdin: stdin,
					},
					...args,
					'--',
					...files,
				),
				repoPath,
				pathspec,
				limit,
				stashes,
				currentUser,
				filters,
			);

			const log: GitLog = {
				repoPath: repoPath,
				commits: commits,
				sha: undefined,
				searchFilters: filters,
				count: commits.size,
				limit: limit,
				hasMore: count - countStashChildCommits > commits.size,
				query: (limit: number | undefined) =>
					this.searchCommits(repoPath, search, { ...options, limit: limit }).then(r => r.log),
			};

			if (log.hasMore) {
				const searchCommitsCore = (log: GitLog): ((limit: number | undefined) => Promise<GitLog>) => {
					return async (limit: number | undefined) => {
						limit = limit ?? 0;

						const moreLog = (
							await this.searchCommits(log.repoPath, search, {
								...options,
								limit: limit,
								skip: log.count,
							})
						).log;
						// If we can't find any more, assume we have everything
						if (moreLog == null) return { ...log, hasMore: false, more: undefined };

						const commits = new Map([...log.commits, ...moreLog.commits]);

						const mergedLog: GitLog = {
							repoPath: log.repoPath,
							commits: commits,
							sha: log.sha,
							searchFilters: filters,
							count: commits.size,
							limit: (log.limit ?? 0) + limit,
							hasMore: moreLog.hasMore,
							query: (limit: number | undefined) =>
								this.searchCommits(log.repoPath, search, { ...options, limit: limit }).then(r => r.log),
						};
						if (mergedLog.hasMore) {
							mergedLog.more = searchCommitsCore(mergedLog);
						}

						return mergedLog;
					};
				};

				log.more = searchCommitsCore(log);
			}

			return { search: search, log: log };
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return { search: search, log: undefined };
		}
	}

	@debug()
	async getCommitSignature(repoPath: string, sha: string): Promise<CommitSignature | undefined> {
		const scope = getScopedLogger();

		try {
			const result = await this.git.run(
				{
					cwd: repoPath,
					errors: 'ignore',
					caching: {
						cache: this.cache.gitResults,
						options: { accessTTL: isSha(sha) ? 5 * 60 * 1000 : 60 * 1000 },
					},
					configs: gitConfigsLog,
				},
				'log',
				`--format=${signatureFormat}`,
				'-1',
				sha,
			);

			if (!result.stdout) return undefined;

			return parseSignatureOutput(result.stdout);
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@debug()
	async isCommitSigned(repoPath: string, sha: string): Promise<boolean> {
		const scope = getScopedLogger();

		try {
			const result = await this.git.run(
				{
					cwd: repoPath,
					errors: 'ignore',
					caching: {
						cache: this.cache.gitResults,
						options: { accessTTL: isSha(sha) ? 5 * 60 * 1000 : 60 * 1000 },
					},
				},
				'cat-file',
				'commit',
				sha,
			);
			return /^gpgsig(-sha256)? /m.test(result.stdout);
		} catch (ex) {
			scope?.error(ex);
			return false;
		}
	}
}

function toCommit(c: ParsedCommit, repoPath: string, pathspec: string | undefined, currentUser: GitUser | undefined) {
	const message = c.message.trim();
	const index = message.indexOf('\n');

	const isCurrentAuthor = isUserMatch(currentUser, c.author, c.authorEmail) || undefined;
	const isCurrentCommitter = isUserMatch(currentUser, c.committer, c.committerEmail) || undefined;

	return new GitCommit(
		repoPath,
		c.sha,
		new GitCommitIdentity(
			c.author,
			c.authorEmail,
			new Date(Number(c.authorDate) * 1000),
			undefined,
			isCurrentAuthor,
		),
		new GitCommitIdentity(
			c.committer,
			c.committerEmail,
			new Date(Number(c.committerDate) * 1000),
			undefined,
			isCurrentCommitter,
		),
		index !== -1 ? message.substring(0, index) : message,
		c.parents?.split(' ') ?? [],
		message,
		createCommitFileset(c, repoPath, pathspec),
		c.stats,
		undefined,
		c.tips?.split(' '),
	);
}

function getGitStartEnd(range: DiffRange): [number, number] {
	// Library DiffRange is always 1-based, startLine <= endLine
	return [range.startLine, range.endLine];
}

async function parseCommits(
	parser: CommitsLogParser | CommitsWithFilesLogParser | CommitsInFileRangeLogParser,
	resultOrStream: Promise<GitResult> | AsyncGenerator<string>,
	repoPath: string,
	pathspec: string | undefined,
	limit: number | undefined,
	stashes: Map<string, GitStashCommit> | undefined,
	currentUser: GitUser | undefined,
	searchFilters?: SearchQueryFilters,
): Promise<{ commits: Map<string, GitCommit>; count: number; countStashChildCommits: number }> {
	let count = 0;
	let countStashChildCommits = 0;
	const commits = new Map<string, GitCommit>();

	const tipsOnly = searchFilters?.type === 'tip';

	if (resultOrStream instanceof Promise) {
		const scope = getScopedLogger();
		const result = await resultOrStream;

		using sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });

		if (stashes?.size) {
			const allowFilteredFiles = searchFilters?.files ?? false;
			const stashesOnly = searchFilters?.type === 'stash';

			for (const c of parser.parse(result.stdout)) {
				if (stashesOnly && !stashes?.has(c.sha)) continue;
				if (tipsOnly && !c.tips) continue;

				count++;
				if (limit && count > limit) break;

				const stash = stashes?.get(c.sha);
				if (stash != null) {
					if (commits.has(stash.sha)) {
						countStashChildCommits++;
					} else if (allowFilteredFiles) {
						commits.set(
							stash.sha,
							stash.with({
								fileset: {
									...createCommitFileset(c, repoPath, pathspec),
									// Add the full stash files back into the fileset
									files: stash.fileset?.files,
								},
							}),
						);
					} else {
						commits.set(stash.sha, stash);
					}
					continue;
				}

				commits.set(c.sha, toCommit(c, repoPath, pathspec, currentUser));
			}
		} else {
			for (const c of parser.parse(result.stdout)) {
				if (tipsOnly && !c.tips) continue;

				count++;
				if (limit && count > limit) break;

				commits.set(c.sha, toCommit(c, repoPath, pathspec, currentUser));
			}
		}

		sw?.stop({ suffix: ` created ${count} commits` });

		return { commits: commits, count: count, countStashChildCommits: countStashChildCommits };
	}

	using _streamDisposer = createDisposable(() => void resultOrStream.return?.(undefined));

	if (stashes?.size) {
		const allowFilteredFiles = searchFilters?.files ?? false;
		const stashesOnly = searchFilters?.type === 'stash';

		for await (const c of parser.parseAsync(resultOrStream)) {
			if (stashesOnly && !stashes?.has(c.sha)) continue;
			if (tipsOnly && !c.tips) continue;

			count++;
			if (limit && count > limit) break;

			const stash = stashes?.get(c.sha);
			if (stash != null) {
				if (commits.has(stash.sha)) {
					countStashChildCommits++;
				} else if (allowFilteredFiles) {
					commits.set(
						stash.sha,
						stash.with({
							fileset: {
								...createCommitFileset(c, repoPath, pathspec),
								// Add the full stash files back into the fileset
								files: stash.fileset?.files,
							},
						}),
					);
				} else {
					commits.set(stash.sha, stash);
				}
				continue;
			}

			commits.set(c.sha, toCommit(c, repoPath, pathspec, currentUser));
		}
	} else {
		for await (const c of parser.parseAsync(resultOrStream)) {
			if (tipsOnly && !c.tips) continue;

			count++;
			if (limit && count > limit) break;

			commits.set(c.sha, toCommit(c, repoPath, pathspec, currentUser));
		}
	}

	return { commits: commits, count: count, countStashChildCommits: countStashChildCommits };
}
