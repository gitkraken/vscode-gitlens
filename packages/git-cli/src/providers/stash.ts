import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { StashApplyError, StashPushError } from '@gitlens/git/errors.js';
import type { GitStashCommit, GitStashParentInfo } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { GitFileWorkingTreeStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitStash } from '@gitlens/git/models/stash.js';
import type { GitStashSubProvider, StashApplyResult } from '@gitlens/git/providers/stash.js';
import { countStringLength } from '@gitlens/utils/array.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { min, skip } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath, splitPath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri, joinUriPath, toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { gitFeaturesByVersion } from '../exec/features.js';
import type { Git } from '../exec/git.js';
import { getGitCommandError, GitError, GitErrors, maxGitCliLength } from '../exec/git.js';
import type { ParsedStash, ParsedStashWithFiles } from '../parsers/logParser.js';
import { getShaAndDatesLogParser, getStashFilesOnlyLogParser, getStashLogParser } from '../parsers/logParser.js';
import { createCommitFileset } from './commitFilesetUtils.js';

export class StashGitSubProvider implements GitStashSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	@gate()
	@debug()
	async applyStash(
		repoPath: string,
		stashName: string,
		options?: { deleteAfter?: boolean },
	): Promise<StashApplyResult> {
		if (!stashName) return { conflicted: false };

		const args = ['stash', options?.deleteAfter ? 'pop' : 'apply', stashName];

		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.context.hooks?.cache?.onReset?.(repoPath, 'stashes');
			this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
			return { conflicted: false };
		} catch (ex) {
			if (ex instanceof Error) {
				const msg: string = ex.message ?? '';
				if (
					(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
					(ex instanceof GitError &&
						((ex.stdout?.includes('Auto-merging') && ex.stdout.includes('CONFLICT')) ||
							ex.stdout?.includes('needs merge')))
				) {
					this.context.hooks?.operations?.onConflicted?.(options?.deleteAfter ? 'stash-pop' : 'stash-apply');
					return { conflicted: true };
				}
			}

			throw getGitCommandError(
				'stash-apply',
				ex,
				reason =>
					new StashApplyError(
						{ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: args } },
						ex,
					),
			);
		}
	}

	@debug()
	async getStash(
		repoPath: string,
		options?: {
			includeFiles?: boolean;
			reachableFrom?: string;
			similarityThreshold?: number | null;
		},
		cancellation?: AbortSignal,
	): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		const cfg = this.context.config;
		const stash = await this.cache.getStash(repoPath, async (commonPath, _cacheable) => {
			const includeFiles = options?.includeFiles ?? cfg?.commits.includeFileDetails ?? true;
			const parser = getStashLogParser(includeFiles);
			const args = [...parser.arguments];

			if (includeFiles) {
				const similarityThreshold = options?.similarityThreshold ?? cfg?.commits.similarityThreshold;
				args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);
			}

			const result = await this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'stash', 'list', ...args);

			const stashes = new Map<string, GitStashCommit>();
			const parentShas = new Set<string>();

			// First pass: create stashes and collect parent SHAs
			for (const s of parser.parse(result.stdout)) {
				stashes.set(s.sha, createStash(s, commonPath));
				// Collect all parent SHAs for timestamp lookup
				if (s.parents) {
					for (const parentSha of s.parents.split(' ')) {
						if (parentSha.trim()) {
							parentShas.add(parentSha.trim());
						}
					}
				}
			}

			// Second pass: fetch parent timestamps if we have any parents
			const parentTimestamps = new Map<string, { authorDate: number; committerDate: number }>();
			if (parentShas.size > 0) {
				try {
					const datesParser = getShaAndDatesLogParser();
					const parentResult = await this.git.exec(
						{
							cwd: repoPath,
							cancellation: cancellation,
							stdin: [...parentShas].join('\n'),
						},
						'log',
						...datesParser.arguments,
						'--no-walk',
						'--stdin',
					);

					for (const entry of datesParser.parse(parentResult.stdout)) {
						parentTimestamps.set(entry.sha, {
							authorDate: Number(entry.authorDate),
							committerDate: Number(entry.committerDate),
						});
					}
				} catch (ex) {
					Logger.debug(`Failed to fetch parent timestamps for stash commits: ${ex}`);
				}
			}

			// Third pass: update stashes with parent timestamp information
			for (const sha of stashes.keys()) {
				const stashCommit = stashes.get(sha);
				if (stashCommit?.parents.length) {
					const parentsWithTimestamps: GitStashParentInfo[] = stashCommit.parents.map(parentSha => ({
						sha: parentSha,
						authorDate: parentTimestamps.get(parentSha)?.authorDate,
						committerDate: parentTimestamps.get(parentSha)?.committerDate,
					}));
					// Store the parent timestamp information on the stash
					stashes.set(sha, stashCommit.with({ parentTimestamps: parentsWithTimestamps }));
				}
			}

			return { repoPath: commonPath, stashes: stashes };
		});

		if (stash == null) return undefined;
		if (!options?.reachableFrom || !stash?.stashes.size) return stash;

		// Return only reachable stashes from the given ref
		// Create a copy because we are going to modify it and we don't want to mutate the cache
		const stashes = new Map(stash.stashes);

		const oldestStashDate = new Date(findOldestStashTimestamp(stash.stashes.values())).toISOString();

		const { reachableFrom } = options;
		const reachableShas = await this.provider.commits.getLogShas(repoPath, reachableFrom, {
			since: oldestStashDate,
			ordering: 'date',
			limit: 0,
		});
		const reachableCommits = new Set(reachableShas);

		if (reachableCommits.size) {
			const reachableStashes = new Set<string>();

			// First pass: mark directly reachable stashes
			for (const [sha, s] of stash.stashes) {
				if (s.parents.some(p => p === reachableFrom || reachableCommits.has(p))) {
					reachableStashes.add(sha);
				}
			}

			// Second pass: mark stashes that build upon reachable stashes
			let changed;
			do {
				changed = false;
				for (const [sha, s] of stash.stashes) {
					if (!reachableStashes.has(sha) && s.parents.some(p => reachableStashes.has(p))) {
						reachableStashes.add(sha);
						changed = true;
					}
				}
			} while (changed);

			// Remove unreachable stashes
			for (const [sha] of stash.stashes) {
				if (!reachableStashes.has(sha)) {
					stashes.delete(sha);
				}
			}
		} else {
			stashes.clear();
		}

		return { ...stash, stashes: stashes };
	}

	@debug()
	async getStashCommitFiles(
		repoPath: string,
		ref: string,
		options?: { similarityThreshold?: number | null },
		cancellation?: AbortSignal,
	): Promise<GitFileChange[]> {
		const [stashFilesResult, stashUntrackedFilesResult] = await Promise.allSettled([
			// Don't include untracked files here, because we won't be able to tell them apart from added (and we need the untracked status)
			this.getStashCommitFilesCore(repoPath, ref, { untracked: false, ...options }, cancellation),
			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			this.getStashCommitFilesCore(repoPath, ref, { untracked: 'only', ...options }, cancellation),
		]);

		let files = getSettledValue(stashFilesResult);
		const untrackedFiles = getSettledValue(stashUntrackedFilesResult);

		if (files?.length && untrackedFiles?.length) {
			files.push(...untrackedFiles);
		} else {
			files = files ?? untrackedFiles;
		}

		return files ?? [];
	}

	private async getStashCommitFilesCore(
		repoPath: string,
		ref: string,
		options?: { similarityThreshold?: number | null; untracked?: boolean | 'only' },
		cancellation?: AbortSignal,
	): Promise<GitFileChange[] | undefined> {
		const args = [];
		if (options?.untracked) {
			args.push(options?.untracked === 'only' ? '--only-untracked' : '--include-untracked');
		}

		const similarityThreshold = options?.similarityThreshold ?? this.context.config?.commits.similarityThreshold;
		if (similarityThreshold != null) {
			args.push(`-M${similarityThreshold}%`);
		}

		const parser = getStashFilesOnlyLogParser();
		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation },
			'stash',
			'show',
			...args,
			...parser.arguments,
			ref,
		);

		const repoUri = fileUri(normalizePath(repoPath));
		for (const s of parser.parse(result.stdout)) {
			return (
				s.files?.map(
					f =>
						new GitFileChange(
							repoPath,
							f.path,
							(options?.untracked === 'only'
								? GitFileWorkingTreeStatus.Untracked
								: f.status) as GitFileStatus,
							joinUriPath(repoUri, normalizePath(f.path)),
							f.originalPath,
							f.originalPath != null ? joinUriPath(repoUri, normalizePath(f.originalPath)) : undefined,
							undefined,
							f.additions || f.deletions
								? {
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: 0,
									}
								: undefined,
							undefined,
							undefined,
							f.mode,
						),
				) ?? []
			);
		}

		return undefined;
	}

	@debug()
	async deleteStash(repoPath: string, stashName: string, sha?: string): Promise<void> {
		await this.deleteStashCore(repoPath, stashName, sha);
		this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
		this.context.hooks?.cache?.onReset?.(repoPath, 'stashes');
	}

	@gate()
	private async deleteStashCore(repoPath: string, stashName: string, sha?: string): Promise<string | undefined> {
		if (!stashName) return undefined;

		let result;
		if (sha) {
			result = await this.git.exec(
				{ cwd: repoPath, errors: 'ignore' },
				'show',
				'--format=%H',
				'--no-patch',
				stashName,
			);
			if (result.stdout.trim() !== sha) {
				throw new Error('Unable to delete stash; mismatch with stash number');
			}
		}

		result = await this.git.exec({ cwd: repoPath }, 'stash', 'drop', stashName);
		return result.stdout;
	}

	@debug()
	async renameStash(
		repoPath: string,
		stashName: string,
		sha: string,
		message: string,
		stashOnRef?: string,
	): Promise<void> {
		await this.deleteStashCore(repoPath, stashName, sha);
		await this.git.exec(
			{ cwd: repoPath },
			'stash',
			'store',
			'-m',
			stashOnRef ? `On ${stashOnRef}: ${message}` : message,
			sha,
		);

		this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
		this.context.hooks?.cache?.onReset?.(repoPath, 'stashes');
	}

	@debug({ args: (repoPath, message, paths) => ({ repoPath: repoPath, message: message, paths: paths?.length }) })
	async saveStash(
		repoPath: string,
		message?: string,
		pathsOrUris?: (string | Uri)[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void> {
		const paths = pathsOrUris?.map(toFsPath);
		if (!paths?.length) {
			await this.stashPushCore(repoPath, message, options);
			this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
			this.context.hooks?.cache?.onReset?.(repoPath, 'stashes', 'status');
			return;
		}

		await this.git.ensureSupports(
			'git:stash:push:pathspecs',
			'Stashing individual files',
			' Please retry by stashing everything or install a more recent version of Git and try again.',
		);

		const pathspecs = paths.map(p => `./${splitPath(p, repoPath)[0]}`);

		let stdin = await this.git.supports('git:stash:push:stdin');
		if (stdin && options?.onlyStaged && paths.length) {
			// Since Git doesn't support --staged with --pathspec-from-file try to pass them in directly
			stdin = false;
		}

		// If we don't support stdin, then error out if we are over the maximum allowed git cli length
		if (!stdin && countStringLength(pathspecs) > maxGitCliLength) {
			await this.git.ensureSupports(
				'git:stash:push:stdin',
				`Stashing so many files (${pathspecs.length}) at once`,
				' Please retry by stashing fewer files or install a more recent version of Git and try again.',
			);
		}

		await this.stashPushCore(repoPath, message, {
			...options,
			pathspecs: pathspecs,
			stdin: stdin,
		});
		this.context.hooks?.cache?.onReset?.(repoPath, 'stashes', 'status');
		this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
	}

	private async stashPushCore(
		repoPath: string,
		message?: string,
		options?: {
			includeUntracked?: boolean;
			keepIndex?: boolean;
			onlyStaged?: boolean;
			pathspecs?: string[];
			stdin?: boolean;
		},
	): Promise<void> {
		const params = ['stash', 'push'];

		if ((options?.includeUntracked || options?.pathspecs?.length) && !options?.onlyStaged) {
			params.push('--include-untracked');
		}

		if (options?.keepIndex && !options?.includeUntracked) {
			params.push('--keep-index');
		}

		if (options?.onlyStaged) {
			if (await this.git.supports('git:stash:push:staged')) {
				params.push('--staged');
			} else {
				throw new Error(
					`Git version ${gitFeaturesByVersion.get(
						'git:stash:push:staged',
					)} or higher is required for --staged`,
				);
			}
		}

		if (message) {
			params.push('-m', message);
		}

		let stdin;
		if (options?.pathspecs?.length) {
			if (options.stdin) {
				stdin = options.pathspecs.join('\0');
				params.push('--pathspec-from-file=-', '--pathspec-file-nul', '--');
			} else {
				params.push('--', ...options.pathspecs);
			}
		} else {
			params.push('--');
		}

		try {
			const result = await this.git.exec({ cwd: repoPath, stdin: stdin }, ...params);
			if (GitErrors.stashNothingToSave.test(result.stdout)) {
				throw new StashPushError({
					reason: 'nothingToSave',
					gitCommand: { repoPath: repoPath, args: params },
				});
			}
		} catch (ex) {
			if (ex instanceof StashPushError) throw ex;

			throw getGitCommandError(
				'stash-push',
				ex,
				reason =>
					new StashPushError(
						{ reason: reason ?? 'other', gitCommand: { repoPath: repoPath, args: params } },
						ex,
					),
			);
		}
	}

	@debug()
	async saveSnapshot(repoPath: string, message?: string): Promise<void> {
		const result = await this.git.exec({ cwd: repoPath }, 'stash', 'create');
		const id = result.stdout.trim() || undefined;
		if (id == null) return;

		const args = [];
		if (message) {
			args.push('-m', message);
		}
		await this.git.exec({ cwd: repoPath }, 'stash', 'store', ...args, id);

		this.context.hooks?.repository?.onChanged?.(repoPath, ['stash']);
		this.context.hooks?.cache?.onReset?.(repoPath, 'stashes');
	}
}

export function convertStashesToStdin(stashOrStashes: GitStash | ReadonlyMap<string, GitStashCommit> | undefined): {
	readonly stdin: string | undefined;
	readonly stashes: Map<string, GitStashCommit>;
	readonly remappedIds: Map<string, string>;
} {
	const remappedIds = new Map<string, string>();
	if (stashOrStashes == null) return { stdin: undefined, stashes: new Map(), remappedIds: remappedIds };

	let stdin: string | undefined;
	const original = 'stashes' in stashOrStashes ? stashOrStashes.stashes : stashOrStashes;
	const stashes = new Map<string, GitStashCommit>(original);

	if (original.size) {
		stdin = '';
		for (const stash of original.values()) {
			stdin += `${stash.sha.substring(0, 9)}\n`;
			// Include the stash's 2nd (index files) and 3rd (untracked files) parents (if they aren't already in the map)
			for (const p of skip(stash.parents, 1)) {
				remappedIds.set(p, stash.sha);

				if (!stashes.has(p)) {
					stashes.set(p, stash);
					stdin += `${p.substring(0, 9)}\n`;
				}
			}
		}
	}

	return { stdin: stdin || undefined, stashes: stashes, remappedIds: remappedIds };
}

const stashSummaryRegex =
	// eslint-disable-next-line no-control-regex
	/(?:(?:(?<wip>WIP) on|On) (?<onref>[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]):\s*)?(?<summary>.*)$/s;

function createStash(s: ParsedStash | ParsedStashWithFiles, repoPath: string): GitStashCommit {
	let message = s.summary.trim();

	let onRef;
	let summary;
	const match = stashSummaryRegex.exec(message);
	if (match?.groups != null) {
		onRef = match.groups.onref;
		summary = match.groups.summary.trim();

		if (summary.length === 0) {
			message = 'WIP';
		} else if (match.groups.wip) {
			message = `WIP: ${summary}`;
		} else {
			message = summary;
		}
	}

	const index = message.indexOf('\n');

	return new GitCommit(
		repoPath,
		s.sha,
		new GitCommitIdentity('You', undefined, new Date(Number(s.authorDate) * 1000)),
		new GitCommitIdentity('You', undefined, new Date(Number(s.committedDate) * 1000)),
		index !== -1 ? message.substring(0, index) : message,
		s.parents.split(' ') ?? [],
		message,
		createCommitFileset(s, repoPath, undefined),
		s.stats,
		undefined,
		undefined,
		s.stashName,
		onRef,
	) as GitStashCommit;
}

/**
 * Finds the oldest timestamp among stash commits and their parent commits.
 * This includes both the stash commit dates and all parent commit timestamps (author and committer dates).
 *
 * @param stashes - Collection of stash commits to analyze
 * @returns The oldest timestamp in milliseconds, or Infinity if no stashes provided
 */
export function findOldestStashTimestamp(stashes: Iterable<GitStashCommit>): number {
	return min(stashes, c => {
		return Math.min(
			c.committer.date.getTime(),
			...(c.parentTimestamps
				?.flatMap(p => [p.authorDate, p.committerDate])
				.filter((x): x is number => x != null)
				.map(x => x * 1000) ?? []),
		);
	});
}
