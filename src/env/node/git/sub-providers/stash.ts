import type { CancellationToken, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import { StashApplyError } from '../../../../git/errors.js';
import type { GitStashSubProvider } from '../../../../git/gitProvider.js';
import type { GitStashCommit, GitStashParentInfo } from '../../../../git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '../../../../git/models/commit.js';
import { GitFileChange } from '../../../../git/models/fileChange.js';
import type { GitFileStatus } from '../../../../git/models/fileStatus.js';
import { GitFileWorkingTreeStatus } from '../../../../git/models/fileStatus.js';
import type { GitStash } from '../../../../git/models/stash.js';
import type { ParsedStash, ParsedStashWithFiles } from '../../../../git/parsers/logParser.js';
import {
	getShaAndDatesLogParser,
	getStashFilesOnlyLogParser,
	getStashLogParser,
} from '../../../../git/parsers/logParser.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { splitPath } from '../../../../system/-webview/path.js';
import { countStringLength } from '../../../../system/array.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug } from '../../../../system/decorators/log.js';
import { min, skip } from '../../../../system/iterable.js';
import { getSettledValue } from '../../../../system/promise.js';
import type { Git } from '../git.js';
import { getGitCommandError, GitError, maxGitCliLength } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';
import { createCommitFileset } from './commits.js';

export class StashGitSubProvider implements GitStashSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@gate()
	@debug()
	async applyStash(repoPath: string, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
		if (!stashName) return;

		const args = ['stash', options?.deleteAfter ? 'pop' : 'apply', stashName];

		try {
			await this.git.exec({ cwd: repoPath }, ...args);
			this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: ['stash'] });
		} catch (ex) {
			if (ex instanceof Error) {
				const msg: string = ex.message ?? '';
				if (
					(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
					(ex instanceof GitError &&
						((ex.stdout?.includes('Auto-merging') && ex.stdout.includes('CONFLICT')) ||
							ex.stdout?.includes('needs merge')))
				) {
					void window.showInformationMessage('Stash applied with conflicts');
					return;
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
		options?: { reachableFrom?: string },
		cancellation?: CancellationToken,
	): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		const stash = await this.cache.getStash(repoPath, async (commonPath, _cacheable) => {
			const includeFiles = !configuration.get('advanced.commits.delayLoadingFileDetails');
			const parser = getStashLogParser(includeFiles);
			const args = [...parser.arguments];

			if (includeFiles) {
				const similarityThreshold = configuration.get('advanced.similarityThreshold');
				args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);
			}

			const result = await this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'stash', 'list', ...args);

			const stashes = new Map<string, GitStashCommit>();
			const parentShas = new Set<string>();

			// First pass: create stashes and collect parent SHAs
			for (const s of parser.parse(result.stdout)) {
				stashes.set(s.sha, createStash(this.container, s, commonPath));
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
				} catch (_ex) {
					// If we can't get parent timestamps, continue without them
					// This could happen if some parent commits are not available
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
		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: ['stash'] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
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

		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: ['stash'] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
	}

	@debug({ args: (repoPath, message, uris) => ({ repoPath: repoPath, message: message, uris: uris?.length }) })
	async saveStash(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void> {
		if (!uris?.length) {
			await this.git.stash__push(repoPath, message, options);
			this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: ['stash'] });
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

		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: ['stash'] });
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

function createStash(container: Container, s: ParsedStash | ParsedStashWithFiles, repoPath: string): GitStashCommit {
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
