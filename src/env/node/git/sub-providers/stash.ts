import type { CancellationToken, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import { StashApplyError, StashApplyErrorReason } from '../../../../git/errors';
import type { GitStashSubProvider } from '../../../../git/gitProvider';
import type { GitStashCommit, GitStashParentInfo } from '../../../../git/models/commit';
import { GitCommit, GitCommitIdentity } from '../../../../git/models/commit';
import { GitFileChange } from '../../../../git/models/fileChange';
import type { GitFileStatus } from '../../../../git/models/fileStatus';
import { GitFileWorkingTreeStatus } from '../../../../git/models/fileStatus';
import { RepositoryChange } from '../../../../git/models/repository';
import type { GitStash } from '../../../../git/models/stash';
import type { ParsedStash } from '../../../../git/parsers/logParser';
import {
	getShaAndDatesLogParser,
	getStashFilesOnlyLogParser,
	getStashLogParser,
} from '../../../../git/parsers/logParser';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { countStringLength } from '../../../../system/array';
import { gate } from '../../../../system/decorators/-webview/gate';
import { log } from '../../../../system/decorators/log';
import { min, skip } from '../../../../system/iterable';
import { getSettledValue } from '../../../../system/promise';
import type { Git } from '../git';
import { GitError, maxGitCliLength } from '../git';
import { createCommitFileset } from './commits';

export class StashGitSubProvider implements GitStashSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
	) {}

	@gate()
	@log()
	async applyStash(repoPath: string, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
		if (!stashName) return;

		try {
			await this.git.exec({ cwd: repoPath }, 'stash', options?.deleteAfter ? 'pop' : 'apply', stashName);
			this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		} catch (ex) {
			if (ex instanceof Error) {
				const msg: string = ex.message ?? '';
				if (msg.includes('Your local changes to the following files would be overwritten by merge')) {
					throw new StashApplyError(StashApplyErrorReason.WorkingChanges, ex);
				}

				if (
					(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
					(ex instanceof GitError &&
						((ex.stdout?.includes('Auto-merging') && ex.stdout.includes('CONFLICT')) ||
							ex.stdout?.includes('needs merge')))
				) {
					void window.showInformationMessage('Stash applied with conflicts');

					return;
				}

				throw new StashApplyError(`Unable to apply stash \u2014 ${msg.trim().replace(/\n+?/g, '; ')}`, ex);
			}

			throw new StashApplyError(`Unable to apply stash \u2014 ${String(ex)}`, ex);
		}
	}

	@log()
	async getStash(
		repoPath: string,
		options?: { reachableFrom?: string },
		cancellation?: CancellationToken,
	): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		const stashPromise = this.cache.stashes?.getOrCreate(repoPath, async _cancellable => {
			const parser = getStashLogParser();
			const args = [...parser.arguments];

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);

			const result = await this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'stash', 'list', ...args);

			const stashes = new Map<string, GitStashCommit>();
			const parentShas = new Set<string>();

			// First pass: create stashes and collect parent SHAs
			for (const s of parser.parse(result.stdout)) {
				stashes.set(s.sha, createStash(this.container, s, repoPath));
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
							stdin: Array.from(parentShas).join('\n'),
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
				} catch (_ex) {
					// If we can't get parent timestamps, continue without them
					// This could happen if some parent commits are not available
				}
			}

			// Third pass: update stashes with parent timestamp information
			for (const sha of stashes.keys()) {
				const stash = stashes.get(sha);
				if (stash?.parents.length) {
					const parentsWithTimestamps: GitStashParentInfo[] = stash.parents.map(parentSha => ({
						sha: parentSha,
						authorDate: parentTimestamps.get(parentSha)?.authorDate,
						committerDate: parentTimestamps.get(parentSha)?.committerDate,
					}));
					// Store the parent timestamp information on the stash
					stashes.set(sha, stash.with({ parentTimestamps: parentsWithTimestamps }));
				}
			}

			return { repoPath: repoPath, stashes: stashes };
		});

		if (stashPromise == null) return undefined;

		const stash = await stashPromise;
		if (!options?.reachableFrom || !stash?.stashes.size) return stash;

		// Return only reachable stashes from the given ref
		// Create a copy because we are going to modify it and we don't want to mutate the cache
		const stashes = new Map(stash.stashes);

		const oldestStashDate = new Date(findOldestStashTimestamp(stash.stashes.values())).toISOString();

		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
			'rev-list',
			`--since="${oldestStashDate}"`,
			'--date-order',
			options.reachableFrom,
			'--',
		);

		const ancestors = result.stdout.trim().split('\n');
		const reachableCommits =
			ancestors?.length && (ancestors.length !== 1 || ancestors[0]) ? new Set(ancestors) : undefined;
		if (reachableCommits?.size) {
			const reachableStashes = new Set<string>();

			// First pass: mark directly reachable stashes
			for (const [sha, s] of stash.stashes) {
				if (s.parents.some(p => p === options.reachableFrom || reachableCommits.has(p))) {
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

	@log()
	async getStashCommitFiles(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<GitFileChange[]> {
		const [stashFilesResult, stashUntrackedFilesResult] = await Promise.allSettled([
			// Don't include untracked files here, because we won't be able to tell them apart from added (and we need the untracked status)
			this.getStashCommitFilesCore(repoPath, ref, { untracked: false }, cancellation),
			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			this.getStashCommitFilesCore(repoPath, ref, { untracked: 'only' }, cancellation),
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
		options?: { untracked?: boolean | 'only' },
		cancellation?: CancellationToken,
	): Promise<GitFileChange[] | undefined> {
		const args = [];
		if (options?.untracked) {
			args.push(options?.untracked === 'only' ? '--only-untracked' : '--include-untracked');
		}

		const similarityThreshold = configuration.get('advanced.similarityThreshold');
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

		for (const s of parser.parse(result.stdout)) {
			return (
				s.files?.map(
					f =>
						new GitFileChange(
							this.container,
							repoPath,
							f.path,
							(options?.untracked === 'only'
								? GitFileWorkingTreeStatus.Untracked
								: f.status) as GitFileStatus,
							f.originalPath,
							undefined,
							f.additions || f.deletions
								? {
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: 0,
									}
								: undefined,
						),
				) ?? []
			);
		}

		return undefined;
	}

	@log()
	async deleteStash(repoPath: string, stashName: string, sha?: string): Promise<void> {
		await this.deleteStashCore(repoPath, stashName, sha);
		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
	}

	@gate()
	private async deleteStashCore(repoPath: string, stashName: string, sha?: string): Promise<string | undefined> {
		if (!stashName) return undefined;

		let result;
		if (sha) {
			result = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Ignore },
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

	@log()
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

		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
	}

	@log<StashGitSubProvider['saveStash']>({ args: { 2: uris => uris?.length } })
	async saveStash(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void> {
		if (!uris?.length) {
			await this.git.stash__push(repoPath, message, options);
			this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes', 'status'] });
			return;
		}

		await this.git.ensureSupports(
			'git:stash:push:pathspecs',
			'Stashing individual files',
			' Please retry by stashing everything or install a more recent version of Git and try again.',
		);

		const pathspecs = uris.map(u => `./${splitPath(u, repoPath)[0]}`);

		let stdin = await this.git.supports('git:stash:push:stdin');
		if (stdin && options?.onlyStaged && uris.length) {
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

		await this.git.stash__push(repoPath, message, {
			...options,
			pathspecs: pathspecs,
			stdin: stdin,
		});
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes', 'status'] });
	}

	@log()
	async saveSnapshot(repoPath: string, message?: string): Promise<void> {
		const result = await this.git.exec({ cwd: repoPath }, 'stash', 'create');
		const id = result.stdout.trim() || undefined;
		if (id == null) return;

		const args = [];
		if (message) {
			args.push('-m', message);
		}
		await this.git.exec({ cwd: repoPath }, 'stash', 'store', ...args, id);

		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
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

function createStash(container: Container, s: ParsedStash, repoPath: string): GitStashCommit {
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
		container,
		repoPath,
		s.sha,
		new GitCommitIdentity('You', undefined, new Date((s.authorDate as unknown as number) * 1000)),
		new GitCommitIdentity('You', undefined, new Date((s.committedDate as unknown as number) * 1000)),
		index !== -1 ? message.substring(0, index) : message,
		s.parents.split(' ') ?? [],
		message,
		createCommitFileset(container, s, repoPath, undefined),
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
			c.date.getTime(),
			...(c.parentTimestamps
				?.flatMap(p => [p.authorDate, p.committerDate])
				.filter((x): x is number => x != null)
				.map(x => x * 1000) ?? []),
		);
	});
}
